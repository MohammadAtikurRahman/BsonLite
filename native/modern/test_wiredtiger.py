"""Compile the real WT12 library and test encrypted data/journals/recovery.

This is a storage/ABI test, not evidence that the MongoDB C++ hooks or Windows
customer engine have passed. Run the separate Windows workflow for that.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parent


def load(file):
    spec = importlib.util.spec_from_file_location(file.stem, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check(mongo, sodium, work):
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This independent ABI probe requires Linux x64")
    report = json.loads((mongo / ".bsonlite-native-patched").read_text())
    if report["engineVersion"] != "9.0.4":
        raise RuntimeError("Apply the pinned modern patch first")
    wt = mongo / "src/third_party/wiredtiger"
    work.mkdir(parents=True, exist_ok=True)
    headers = work / "include"
    headers.mkdir(exist_ok=True)
    config = (wt / "build_linux/wiredtiger_config.h.in").read_text()
    previous_directory = Path.cwd()
    try:
        os.chdir(work)
        replacements = load(wt / "wt_config_header.py").generate_config_header(
            shutil.which("g++"), "-O2", "{}", str(work / "config.log"))
    finally:
        os.chdir(previous_directory)
    for key, value in replacements.items():
        config = config.replace(key, value)
    if re.search(r"@[A-Za-z0-9_]+@", config):
        raise RuntimeError("An upstream configuration token was not substituted")
    (headers / "wiredtiger_config.h").write_text(config)
    api = (wt / "src/include/wiredtiger.h.in").read_text()
    for key, value in {"VERSION_MAJOR": "12", "VERSION_MINOR": "0", "VERSION_PATCH": "0",
                       "VERSION_STRING": '"WiredTiger 12.0.0 BsonLite ABI test"'}.items():
        api = api.replace("@" + key + "@", value)
    (headers / "wiredtiger.h").write_text(api)
    shutil.copyfile(wt / "src/include/wiredtiger_ext.h", headers / "wiredtiger_ext.h")
    lists = {}
    exec((wt / "dist/filelist.bzl").read_text(), {}, lists)
    sources = lists["WT_FILELIST"] + lists["WT_FILELIST_X86_HOST"] + lists["WT_FILELIST_POSIX_HOST"] + lists["WT_FILELIST_LINUX_HOST"]
    sources = [wt / name for name in sources]
    sources += [NATIVE / "src/bsonlite_crypto.c", NATIVE / "src/bsonlite_wiredtiger.c"]
    quote = lambda path: json.dumps(str(path.resolve()))
    cmake = '''cmake_minimum_required(VERSION 3.20)
project(bsonlite_wt12_abi C)
set(CMAKE_C_STANDARD 11)
add_library(wt12 STATIC %s)
target_include_directories(wt12 PUBLIC %s %s %s %s)
target_compile_definitions(wt12 PRIVATE _GNU_SOURCE HAVE_VERBOSE HAVE_BUILTIN_EXTENSION_BSONLITE BSONLITE_STATIC SODIUM_STATIC)
target_compile_options(wt12 PRIVATE -O2 -msse4.2 -mpclmul)
target_link_libraries(wt12 PUBLIC %s pthread dl rt)
add_executable(wt_probe %s)
target_link_libraries(wt_probe PRIVATE wt12)
''' % ("\n".join(map(quote, sources)), quote(headers), quote(wt / "src/include"),
       quote(NATIVE / "src"), quote(sodium / "include"), quote(sodium / "lib/libsodium.a"), quote(HERE / "wt_probe.c"))
    (work / "CMakeLists.txt").write_text(cmake)
    subprocess.run(["cmake", "-S", str(work), "-B", str(work / "build"), "-G", "Ninja"], check=True)
    subprocess.run(["cmake", "--build", str(work / "build"), "-j", "4"], check=True)
    probe = work / "build/wt_probe"
    # Every invocation owns a new fixture, including retries after compilation.
    import tempfile
    home = Path(tempfile.mkdtemp(prefix="database-", dir=work))
    key_id, key = os.urandom(16), os.urandom(32)
    frame = b"BSLKEY01" + key_id + key

    def run(directory, mode, secret=frame):
        return subprocess.run([str(probe), str(directory), mode, key_id.hex()], input=secret, capture_output=True)

    for mode in ("write", "read"):
        result = run(home, mode)
        if result.returncode:
            raise RuntimeError(mode + " failed: " + result.stderr.decode(errors="replace")[-4000:])
    encrypted_files, encrypted_logs = 0, 0
    for file in home.rglob("*"):
        if not file.is_file():
            continue
        data = file.read_bytes()
        if b"BSL_PRIVATE_WT12_SENTINEL" in data:
            raise RuntimeError("Plaintext record observed in " + file.name)
        if b"BSLAE001" in data:
            encrypted_files += 1
            if file.name.startswith("WiredTigerLog"):
                encrypted_logs += 1
    if not encrypted_files or not encrypted_logs:
        raise RuntimeError("Actual encrypted data and journal blocks were not observed")
    if run(home, "read", b"BSLKEY01" + key_id + os.urandom(32)).returncode == 0:
        raise RuntimeError("A wrong key was accepted")
    if run(home, "read", frame + b"x").returncode == 0:
        raise RuntimeError("An oversized key frame was accepted")
    damaged = work / (home.name + "-tampered")
    shutil.copytree(home, damaged)
    blocks = 0
    # A WT file retains unused/older checkpoint blocks. Corrupting only the
    # first matching byte sequence does not prove that a live block was read.
    # Damage the ciphertext of all observed frames in this disposable copy.
    for file in damaged.rglob("*"):
        if not file.is_file():
            continue
        data = bytearray(file.read_bytes())
        offset = data.find(b"BSLAE001")
        changed = False
        while offset >= 0:
            if offset + 32 < len(data):
                data[offset + 32] ^= 1
                changed = True
                blocks += 1
            offset = data.find(b"BSLAE001", offset + 8)
        if changed:
            file.write_bytes(data)
    if not blocks:
        raise RuntimeError("Encrypted blocks were not found")
    if run(damaged, "read").returncode == 0:
        raise RuntimeError("Tampered ciphertext was accepted")
    evidence = {"engineSource": "9.0.4", "wiredTiger": "12.0.0", "records": 2048,
                "readWriteRestart": "passed", "encryptedDataAndJournal": "passed",
                "wrongKey": "rejected", "oversizedKeyFrame": "rejected", "tamperedCiphertext": "rejected",
                "mongoCppHooks": "not-tested", "windowsEngine": "not-tested"}
    (work / "validation.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mongo", required=True, type=Path)
    parser.add_argument("--sodium-root", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    check(args.mongo.resolve(), args.sodium_root.resolve(), args.work.resolve())
