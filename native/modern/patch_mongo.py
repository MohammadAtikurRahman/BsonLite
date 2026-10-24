"""Port the existing BsonLite cipher to the exact MongoDB 9.0.4 source.

Never accepts a fuzzy patch. A successful patch is NOT a validated engine.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parent
LOCK = json.loads((HERE / "deps.lock.json").read_text())


def patch(mongo, sodium_include, sodium_library):
    mongo = mongo.resolve()
    marker = mongo / ".bsonlite-native-patched"
    if marker.exists():
        raise RuntimeError("Use a fresh pinned source tree; an existing patch was found")
    release = (mongo / "src/third_party/wiredtiger/RELEASE_INFO").read_text()
    for value in ("WIREDTIGER_VERSION_MAJOR=12", "WIREDTIGER_VERSION_MINOR=0", "WIREDTIGER_VERSION_PATCH=0"):
        if value not in release:
            raise RuntimeError("Expected the pinned WiredTiger 12.0.0 ABI")
    # Stage every textual change in memory. Source drift leaves the tree untouched.
    changes = {}

    def replace(name, before, after):
        text = changes.get(name, (mongo / name).read_text())
        if text.count(before) != 1:
            raise RuntimeError(f"Upstream source drift at {name}: expected one exact match")
        changes[name] = text.replace(before, after)

    def dependency(name, target):
        text = changes.get(name, (mongo / name).read_text())
        start = text.index('    name = "' + target + '",')
        end = text.index('\n)\n', start)
        block = text[start:end]
        before = '    deps = ['
        if block.count(before) != 1:
            raise RuntimeError(f"Unexpected Bazel target {target}")
        updated = block.replace(before, before + '\n        "//src/third_party/bsonlite_crypto",', 1)
        changes[name] = text[:start] + updated + text[end:]

    conn = "src/third_party/wiredtiger/src/conn/conn_api.c"
    replace(conn, '#ifdef HAVE_BUILTIN_EXTENSION_LZ4\nextern int lz4_extension_init',
            '#ifdef HAVE_BUILTIN_EXTENSION_BSONLITE\nextern int bsonlite_wiredtiger_init(WT_CONNECTION *, WT_CONFIG_ARG *);\n#endif\n#ifdef HAVE_BUILTIN_EXTENSION_LZ4\nextern int lz4_extension_init')
    replace(conn, '__conn_builtin_extensions(WT_CONNECTION_IMPL *conn, const char *cfg[])\n{',
            '__conn_builtin_extensions(WT_CONNECTION_IMPL *conn, const char *cfg[])\n{\n#ifdef HAVE_BUILTIN_EXTENSION_BSONLITE\n    WT_RET(__conn_builtin_init(conn, "bsonlite", bsonlite_wiredtiger_init, cfg));\n#endif')
    wtbuild = "src/third_party/wiredtiger/BUILD.bazel"
    replace(wtbuild, 'WT_DEFINES = [', 'WT_DEFINES = [\n    "HAVE_BUILTIN_EXTENSION_BSONLITE",\n    "BSONLITE_STATIC",')
    replace(wtbuild, '        "ext/compressors/snappy/snappy_compress.c",',
            '        "ext/compressors/snappy/snappy_compress.c",\n        "ext/encryptors/bsonlite/bsonlite_wiredtiger.c",')
    dependency(wtbuild, "wiredtiger")
    dependency("src/mongo/db/storage/BUILD.bazel", "encryption_hooks")
    dependency("src/mongo/db/storage/wiredtiger/BUILD.bazel", "storage_wiredtiger_core")
    dependency("src/mongo/db/BUILD.bazel", "mongod_main")
    include = '#include "third_party/bsonlite_crypto/bsonlite_crypto.h"\n'
    main = "src/mongo/db/mongod_main.cpp"
    replace(main, '#include "mongo/db/mongod_main.h"', '#include "mongo/db/mongod_main.h"\n#include <cstdio>\n#include <cstring>\n' + include)
    replace(main, 'int mongod_main(int argc, char* argv[]) {', '''int mongod_main(int argc, char* argv[]) {
    if (argc == 2 && std::strcmp(argv[1], "--bsonlite-native-self-test") == 0) {
        if (bsonlite_crypto_selftest() != 0) return 1;
        std::puts("{\\"bsonliteNativeEncryption\\":1,\\"engineVersion\\":\\"9.0.4\\",\\"cipher\\":\\"xchacha20-poly1305\\",\\"selfTest\\":true,\\"temporaryFiles\\":true,\\"libsodium\\":\\"1.0.22\\"}");
        std::fflush(stdout);
        return 0;
    }
    bool bsonliteInformational = false;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--version") == 0 || std::strcmp(argv[i], "--help") == 0 ||
            std::strcmp(argv[i], "-h") == 0) bsonliteInformational = true;
    }
    if (!bsonliteInformational && bsonlite_load_key() != 0) {
        std::fputs("BsonLite requires an authenticated key frame before engine startup.\\n", stderr);
        std::fflush(stderr);
        return 14;
    }''')
    hooks = "src/mongo/db/storage/encryption_hooks.cpp"
    replace(hooks, '#include "mongo/db/storage/encryption_hooks.h"', '#include "mongo/db/storage/encryption_hooks.h"\n' + include)
    replace(hooks, 'bool EncryptionHooks::enabled() const {\n    return false;',
            'bool EncryptionHooks::enabled() const {\n    return bsonlite_key_ready() != 0;')
    replace(hooks, 'std::unique_ptr<DataProtector> EncryptionHooks::getDataProtector() {\n    return std::unique_ptr<DataProtector>();\n}',
            (HERE / "hooks.inc").read_text() + '\nstd::unique_ptr<DataProtector> EncryptionHooks::getDataProtector() {\n    return std::make_unique<BsonLiteRemoveProtector>();\n}')
    replace(hooks, 'boost::filesystem::path EncryptionHooks::getProtectedPathSuffix() {\n    return "";',
            'boost::filesystem::path EncryptionHooks::getProtectedPathSuffix() {\n    return ".bsonlite-encrypted";')
    replace(hooks, '    return Status(ErrorCodes::InternalError,\n                  "Encryption hooks must be enabled to use preprocessTmpData.");',
            '    return bsonliteTransform(in, out, true, BSL_TEMP_DOMAIN);')
    replace(hooks, '    return Status(ErrorCodes::InternalError,\n                  "Encryption hooks must be enabled to use postprocessTmpData.");',
            '    return bsonliteTransform(in, out, false, BSL_TEMP_DOMAIN);')
    replace("src/mongo/db/storage/encryption_hooks.h", "        return 33;", "        return 52; // BsonLite AEAD overhead plus framed RemoveSaver length")
    kv = "src/mongo/db/storage/wiredtiger/wiredtiger_kv_engine.cpp"
    replace(kv, '#include "mongo/db/storage/wiredtiger/wiredtiger_kv_engine.h"',
            '#include "mongo/db/storage/wiredtiger/wiredtiger_kv_engine.h"\n' + include)
    # The new server also opens an independent WT instance for spilling. The
    # shared open-config generator must encrypt its metadata and journals too.
    replace(kv, '    return ss.str();\n}\n\nWiredTigerKVEngineBase::WiredTigerKVEngineBase',
            '''    if (bsonlite_key_ready()) {
        ss << ",encryption=(name=bsonlite_xchacha20_v1,keyid=" << bsonlite_key_id() << ")";
    }
    return ss.str();
}

WiredTigerKVEngineBase::WiredTigerKVEngineBase''')
    for file, anchor in [("wiredtiger_record_store.cpp", "    return ss;\n}\n\nvoid WiredTigerRecordStore::wtDeleteRecord"),
                         ("wiredtiger_index.cpp", "    return StatusWith<std::string>(ss);\n}\n")]:
        name = "src/mongo/db/storage/wiredtiger/" + file
        header = '#include "mongo/db/storage/wiredtiger/' + file.replace('.cpp', '.h') + '"'
        replace(name, header, header + '\n' + include)
        forced = '''    if (bsonlite_key_ready()) {
        ss << ",encryption=(name=bsonlite_xchacha20_v1,keyid=" << bsonlite_key_id() << ")";
    }
'''
        replace(name, anchor, forced + anchor)
    dumps = "src/mongo/util/exception_filter_win32.cpp"
    text = (mongo / dumps).read_text()
    start = text.index("void doMinidumpWithException(struct _EXCEPTION_POINTERS* exceptionInfo) {")
    # Only replace the function. The following anonymous-namespace closing
    # brace is part of the new upstream layout and must remain intact.
    body = text.index("{", start)
    depth, end = 0, None
    tokens = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|[{}]')
    for token in tokens.finditer(text, body):
        if token.group() == "{":
            depth += 1
        elif token.group() == "}":
            depth -= 1
            if depth == 0:
                end = token.end()
                break
    if end is None:
        raise RuntimeError("The upstream minidump function was not balanced")
    replace(dumps, text[start:end], "void doMinidumpWithException(struct _EXCEPTION_POINTERS* exceptionInfo) {\n    (void)exceptionInfo; // Engine-generated plaintext memory dumps are disabled.\n}\n")
    library = sodium_library.resolve()
    if not library.is_file() or not (sodium_include / "sodium.h").is_file():
        raise RuntimeError("The actual static libsodium library and headers are required")
    target = mongo / "src/third_party/bsonlite_crypto"
    if target.exists():
        raise RuntimeError("Refusing to overwrite an existing crypto target")
    target.mkdir()
    for name in ["bsonlite_crypto.c", "bsonlite_crypto.h"]:
        shutil.copyfile(NATIVE / "src" / name, target / name)
    shutil.copytree(sodium_include, target / "include")
    shutil.copyfile(library, target / library.name)
    (target / "BUILD.bazel").write_text('''load("@rules_cc//cc:defs.bzl", "cc_import", "cc_library")
package(default_visibility = ["//visibility:public"])
cc_import(name = "sodium", static_library = %s)
cc_library(
    name = "bsonlite_crypto",
    srcs = ["bsonlite_crypto.c"],
    hdrs = ["bsonlite_crypto.h"] + glob(["include/**/*.h"]),
    includes = [".", "include"],
    defines = ["SODIUM_STATIC"],
    deps = [":sodium"],
    linkopts = select({"@platforms//os:windows": ["advapi32.lib", "bcrypt.lib"], "//conditions:default": ["-pthread"]}),
)
''' % json.dumps(library.name))
    extension = mongo / "src/third_party/wiredtiger/ext/encryptors/bsonlite"
    extension.mkdir()
    (extension / "bsonlite_wiredtiger.c").write_text((NATIVE / "src/bsonlite_wiredtiger.c").read_text().replace("WiredTiger 3.1.1 encryptor", "WiredTiger encryptor"))
    for name, text in changes.items():
        (mongo / name).write_text(text)
    digest = hashlib.sha256()
    for file in [HERE / "deps.lock.json", Path(__file__), HERE / "hooks.inc", *sorted((NATIVE / "src").glob("bsonlite_*.*"))]:
        data = file.read_bytes()
        digest.update(len(data).to_bytes(8, "big")); digest.update(data)
    report = {"engineVersion": LOCK["mongo"]["version"], "upstreamCommit": LOCK["mongo"]["commit"],
              "patchSha256": digest.hexdigest(), "modifiedFiles": sorted(changes), "validated": False}
    marker.write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mongo", type=Path)
    parser.add_argument("--sodium-include", required=True, type=Path)
    parser.add_argument("--sodium-library", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(patch(args.mongo, args.sodium_include, args.sodium_library), indent=2))
