"""Pinned developer dependencies and WiredTiger ABI headers. Python 3.12+."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / "deps.lock.json").read_text())


def download(name, directory):
    spec = LOCK[name]
    target = directory / spec.get("filename", name + (".zip" if name.endswith("msvc") else ".tar.gz"))
    if not target.exists():
        request = urllib.request.Request(spec["url"], headers={"User-Agent": "BsonLite-native-builder"})
        temporary = target.with_suffix(target.suffix + ".partial")
        try:
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("xb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            temporary.rename(target)
        finally:
            temporary.unlink(missing_ok=True)
    if hashlib.sha256(target.read_bytes()).hexdigest() != spec["sha256"]:
        raise RuntimeError(f"{name} checksum mismatch; remove the damaged cache and retry")
    return target


def unpack(archive, directory):
    if archive.suffix in [".zip", ".whl", ".nupkg"]:
        with zipfile.ZipFile(archive) as source:
            for entry in source.infolist():
                path = directory / entry.filename
                if not path.resolve().is_relative_to(directory.resolve()):
                    raise RuntimeError("Unsafe ZIP member")
            source.extractall(directory)
    else:
        with tarfile.open(archive, "r:gz") as source:
            source.extractall(directory, filter="data")


def headers(mongo, output, windows=False):
    source = mongo / "src/third_party/wiredtiger"
    output.mkdir(parents=True, exist_ok=True)
    text = (source / "src/include/wiredtiger.in").read_text()
    values = {
        "VERSION_MAJOR": "3", "VERSION_MINOR": "1", "VERSION_PATCH": "1",
        "VERSION_STRING": '"WiredTiger 3.1.1: MongoDB 4.0.28 ABI"',
        "uintmax_t_decl": "", "uintptr_t_decl": "",
        "off_t_decl": "typedef int64_t wt_off_t;" if windows else "typedef off_t wt_off_t;",
        "wiredtiger_includes_decl": "\n".join([
            "#include <sys/types.h>", "#include <stdarg.h>", "#include <stdbool.h>",
            "#include <stdint.h>", "#include <stdio.h>",
        ]),
    }
    for name, value in values.items():
        text = text.replace("@" + name + "@", value)
    if "@VERSION_" in text:
        raise RuntimeError("Unexpected WiredTiger header template")
    (output / "wiredtiger.h").write_text(text)
    (output / "wiredtiger_ext.h").write_bytes((source / "src/include/wiredtiger_ext.h").read_bytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=ROOT / "build/dependencies")
    parser.add_argument("--windows", action="store_true")
    args = parser.parse_args()
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    for name in ["mongo", "sodium"]:
        archive = download(name, work)
        top = "mongo-" + LOCK["mongo"]["commit"] if name == "mongo" else "libsodium-" + LOCK["sodium"]["version"]
        if not (work / top).exists():
            unpack(archive, work)
    mongo = work / ("mongo-" + LOCK["mongo"]["commit"])
    headers(mongo, work / "wt-headers", args.windows)
    if args.windows:
        # This legacy CRT belongs only to the Python 2 build host. The engine
        # itself uses a static CRT and never bundles this installer.
        download("vc90", work)
        archive = download("python2", work)
        python_root = work / "python27"
        if not python_root.exists():
            unpack(archive, python_root)
        packages = python_root / "tools/Lib/site-packages"
        for i, wheel in enumerate(LOCK["builder_wheels"]):
            key = "wheel" + str(i)
            LOCK[key] = wheel
            unpack(download(key, work), packages)
        # Keep pywin32's dependent DLLs beside the private build interpreter.
        # No post-install script, registry writes or system-directory copies.
        for file in (packages / "pywin32_system32").glob("*.dll"):
            shutil.copyfile(file, python_root / "tools" / file.name)
    print(json.dumps({"mongo": str(mongo), "work": str(work)}))


if __name__ == "__main__":
    main()
