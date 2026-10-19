"""Apply the BsonLite native patch to the exact pinned MongoDB source tree."""
import argparse
import hashlib
import re
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent


def replace(root, name, old, new):
    path = root / name
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"Unexpected upstream source at {name}; refusing an ambiguous patch")
    path.write_text(text.replace(old, new))


def patch(mongo, sodium_include, sodium_library):
    if (mongo / ".bsonlite-native-patched").exists():
        raise RuntimeError("Use a fresh pinned source tree for each native build")
    # Reject a different ABI before modifying anything.
    release = (mongo / "src/third_party/wiredtiger/RELEASE_INFO").read_text()
    if "WIREDTIGER_VERSION_MINOR=1" not in release or "WIREDTIGER_VERSION_PATCH=1" not in release:
        raise RuntimeError("Expected MongoDB 4.0.28 / WiredTiger 3.1.1")
    # This upstream header uses _mul128 but relies on an unrelated include to
    # declare it. Some translation units lack that incidental declaration on v141.
    replace(mongo, "src/mongo/platform/overflow_arithmetic.h",
            "#ifdef _MSC_VER\n#include <safeint.h>\n#endif",
            "#ifdef _MSC_VER\n#include <intrin.h>\n#include <safeint.h>\n#endif")
    target = mongo / "src/third_party/wiredtiger/ext/encryptors/bsonlite"
    target.mkdir(parents=True)
    for name in ["bsonlite_crypto.c", "bsonlite_crypto.h", "bsonlite_wiredtiger.c"]:
        shutil.copyfile(ROOT / "src" / name, target / name)
    replace(mongo, "src/third_party/wiredtiger/SConscript", "wtsources = list(filtered_filelist(filelist))", """wtsources = list(filtered_filelist(filelist))
env.Append(CPPDEFINES=['HAVE_BUILTIN_EXTENSION_BSONLITE', 'BSONLITE_STATIC', 'SODIUM_STATIC'])
env.Append(CPPPATH=[%r, 'ext/encryptors/bsonlite'])
wtsources += ['ext/encryptors/bsonlite/bsonlite_crypto.c', 'ext/encryptors/bsonlite/bsonlite_wiredtiger.c']""" % str(sodium_include.resolve()))
    replace(mongo, "src/third_party/wiredtiger/src/conn/conn_api.c",
            "#ifdef HAVE_BUILTIN_EXTENSION_LZ4\nextern int lz4_extension_init", """#ifdef HAVE_BUILTIN_EXTENSION_BSONLITE
extern int bsonlite_wiredtiger_init(WT_CONNECTION *, WT_CONFIG_ARG *);
#endif
#ifdef HAVE_BUILTIN_EXTENSION_LZ4
extern int lz4_extension_init""")
    replace(mongo, "src/third_party/wiredtiger/src/conn/conn_api.c",
            "__conn_builtin_extensions(WT_CONNECTION_IMPL *conn, const char *cfg[])\n{", """__conn_builtin_extensions(WT_CONNECTION_IMPL *conn, const char *cfg[])
{
#ifdef HAVE_BUILTIN_EXTENSION_BSONLITE
    WT_RET(__conn_builtin_init(conn, "bsonlite", bsonlite_wiredtiger_init, cfg));
#endif""")
    # Link the same static crypto library into consumers of the patched engine.
    replace(mongo, "SConstruct", "Export('module_sconscripts')", """# BsonLite: static libsodium, pinned by native/deps.lock.json.
env.Append(LIBS=[env.File(%r)])
Export('module_sconscripts')""" % str(sodium_library.resolve()))
    include = '#include "third_party/wiredtiger/ext/encryptors/bsonlite/bsonlite_crypto.h"\n'
    replace(mongo, "src/mongo/db/db.cpp", '#include "mongo/platform/basic.h"', '#include "mongo/platform/basic.h"\n#include <cstdio>\n#include <cstring>\n' + include)
    replace(mongo, "src/mongo/db/db.cpp", "int mongoDbMain(int argc, char* argv[], char** envp) {", """int mongoDbMain(int argc, char* argv[], char** envp) {
    if (argc == 2 && std::strcmp(argv[1], "--bsonlite-native-self-test") == 0) {
        if (bsonlite_crypto_selftest() != 0) return 1;
        std::puts("{\\\"bsonliteNativeEncryption\\\":1,\\\"cipher\\\":\\\"xchacha20-poly1305\\\",\\\"selfTest\\\":true,\\\"temporaryFiles\\\":true,\\\"libsodium\\\":\\\"1.0.22\\\"}");
        return 0;
    }""")
    # SChannel's PEM reader otherwise opens UTF-8 paths with the ANSI CRT API.
    # Private OS data can be under a non-ASCII Windows account/profile name.
    replace(mongo, "src/mongo/util/net/ssl_manager_windows.cpp",
            '    std::ifstream pemFile(fileName.toString(), std::ios::binary);',
            '    const auto wideName = toWideString(fileName.toString().c_str());\n'
            '    std::ifstream pemFile(wideName.c_str(), std::ios::binary);')
    # Engine-created minidumps can contain plaintext values or key material.
    # Keep OS-managed dumps outside the guarantee, but remove our own writer.
    dumps = "src/mongo/util/exception_filter_win32.cpp"
    text = (mongo / dumps).read_text()
    start = text.index("void doMinidumpWithException(struct _EXCEPTION_POINTERS* exceptionInfo) {")
    end = text.index("\nLONG WINAPI exceptionFilter", start)
    replace(mongo, dumps, text[start:end], """void doMinidumpWithException(struct _EXCEPTION_POINTERS* exceptionInfo) {
    (void)exceptionInfo;
    log() << "BsonLite engine memory dumps are disabled.";
}
""")
    hooks = "src/mongo/db/storage/encryption_hooks.cpp"
    replace(mongo, hooks, '#include "mongo/platform/basic.h"', '#include "mongo/platform/basic.h"\n' + include)
    replace(mongo, hooks, '    return false;\n}\n\nbool EncryptionHooks::restartRequired()', '    return bsonlite_key_ready() != 0;\n}\n\nbool EncryptionHooks::restartRequired()')
    replace(mongo, "src/mongo/db/storage/encryption_hooks.h", "        return 33;", "        return 52; // BsonLite AEAD overhead plus framed RemoveSaver length")
    replace(mongo, hooks, "std::unique_ptr<DataProtector> EncryptionHooks::getDataProtector() {\n    return std::unique_ptr<DataProtector>();\n}",
            (ROOT / "src/mongo_hooks.inc").read_text() + '\nstd::unique_ptr<DataProtector> EncryptionHooks::getDataProtector() {\n    return std::make_unique<BsonLiteRemoveProtector>();\n}')
    replace(mongo, hooks, 'boost::filesystem::path EncryptionHooks::getProtectedPathSuffix() {\n    return "";\n}', 'boost::filesystem::path EncryptionHooks::getProtectedPathSuffix() {\n    return ".bsonlite-encrypted";\n}')
    replace(mongo, hooks, '    return Status(ErrorCodes::InternalError,\n                  "Encryption hooks must be enabled to use preprocessTmpData.");',
            '    if (bsonlite_encrypt(BSL_TEMP_DOMAIN,in,inLen,out,outLen,resultLen) != 0)\n        return Status(ErrorCodes::OperationFailed,"BsonLite temporary data encryption failed");\n    return Status::OK();')
    replace(mongo, hooks, '    return Status(ErrorCodes::InternalError,\n                  "Encryption hooks must be enabled to use postprocessTmpData.");',
            '    if (bsonlite_decrypt(BSL_TEMP_DOMAIN,in,inLen,out,outLen,resultLen) != 0)\n        return Status(ErrorCodes::OperationFailed,"BsonLite temporary data authentication failed");\n    return Status::OK();')
    for file in ["wiredtiger_record_store.cpp", "wiredtiger_index.cpp"]:
        relative = "src/mongo/db/storage/wiredtiger/" + file
        replace(mongo, relative, '#include "mongo/platform/basic.h"', '#include "mongo/platform/basic.h"\n' + include)
        # This is the one return in generateCreateString; append after all user configuration.
        replace(mongo, relative, "    return StatusWith<std::string>(ss);", """    if (bsonlite_key_ready()) {
        ss << ",encryption=(name=bsonlite_xchacha20_v1,keyid=" << bsonlite_key_id() << ")";
    }
    return StatusWith<std::string>(ss);""")
    # Old server branches do not expose every error name from modern MongoDB.
    known_codes = set(re.findall(r'error_code\("(\w+)"',
                                (mongo / "src/mongo/base/error_codes.err").read_text()))
    used_codes = set(re.findall(r'\bErrorCodes::(\w+)', (mongo / hooks).read_text()))
    if used_codes - known_codes:
        raise RuntimeError("Native hooks reference unavailable server error codes: " +
                           ", ".join(sorted(used_codes - known_codes)))
    # Include the patching logic as well as its copied implementation. Otherwise
    # a changed table/temp-hook patch would retain the same provenance digest.
    digest = hashlib.sha256()
    for file in [Path(__file__), *(ROOT / "src" / name for name in
                 ["bsonlite_crypto.c", "bsonlite_crypto.h", "bsonlite_wiredtiger.c", "mongo_hooks.inc"])]:
        content = file.read_bytes()
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    (mongo / ".bsonlite-native-patched").write_text(digest.hexdigest() + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mongo", type=Path)
    parser.add_argument("--sodium-include", required=True, type=Path)
    parser.add_argument("--sodium-library", required=True, type=Path)
    options = parser.parse_args()
    patch(options.mongo.resolve(), options.sodium_include, options.sodium_library)
    print("Patched the pinned MongoDB/WiredTiger source; native build and tests are still required.")
