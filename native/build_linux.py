"""Build the Linux-only WiredTiger prototype, not a full production engine."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from prepare import LOCK, download, headers, unpack

ROOT = Path(__file__).resolve().parent


def run(command, cwd=None):
    subprocess.run([str(item) for item in command], cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=ROOT / "build/dependencies")
    parser.add_argument("--mongo-binary", required=True, type=Path)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise RuntimeError("This is the Linux x64 prototype builder; use build_windows.ps1 for Windows")
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    mongo = work / ("mongo-" + LOCK["mongo"]["commit"])
    sodium = work / ("libsodium-" + LOCK["sodium"]["version"])
    for name, target in [("mongo", mongo), ("sodium", sodium)]:
        archive = download(name, work)
        if not target.exists():
            unpack(archive, work)
    generated = work / "wt-headers"
    headers(mongo, generated)
    library = sodium / "src/libsodium/.libs/libsodium.a"
    if not library.exists():
        run(["./configure", "--disable-shared", "--enable-static", "--with-pic"], sodium)
        run(["make", "-j4"], sodium)
    output = ROOT / "build/linux-x64"
    output.mkdir(parents=True, exist_ok=True)
    common = ["gcc", "-std=c99", "-Wall", "-Wextra", "-Werror", "-O2", "-fPIC",
              "-fstack-protector-strong", "-DSODIUM_STATIC", "-I" + str(generated),
              "-I" + str(sodium / "src/libsodium/include"), "-I" + str(ROOT / "src")]
    core = ROOT / "src/bsonlite_crypto.c"
    run(common + ["-shared", core, ROOT / "src/bsonlite_wiredtiger.c", library, "-pthread",
                  "-o", output / "bsonlite_encryptor.so"])
    run(common + [core, ROOT / "src/crypto_probe.c", library, "-pthread", "-o", output / "crypto_probe"])
    run([output / "crypto_probe"])
    binary = args.mongo_binary.resolve()
    manifest = {
        "version": 1, "cipher": "xchacha20-poly1305", "mode": "extension-prototype",
        "platform": "linux", "arch": "x64", "engineVersion": "4.0.28",
        "engineSha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "extension": "bsonlite_encryptor.so",
        "extensionSha256": hashlib.sha256((output / "bsonlite_encryptor.so").read_bytes()).hexdigest(),
        "probe": "crypto_probe", "probeSha256": hashlib.sha256((output / "crypto_probe").read_bytes()).hexdigest(),
        "temporaryFiles": False, "libsodiumVersion": LOCK["sodium"]["version"],
    }
    (output / "native-engine.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Linux WiredTiger prototype built. It does not include MongoDB temporary-file hooks.")


if __name__ == "__main__":
    main()
