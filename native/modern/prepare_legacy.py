"""Materialise the immutable previous SDK as a migration test fixture only."""
import argparse
import base64
import hashlib
from pathlib import Path
import tarfile
import urllib.request

URL = "https://registry.npmjs.org/bsonlite-sdk/-/bsonlite-sdk-0.6.0-rc.3.tgz"
INTEGRITY = "V/ZIvIS1ZFSMftAG3bfmrc73XlsjRcUAjO40qdHPDFskD6+sRvbW8TSEFkqySAbYAJnG6RwaxtnteDJKP0mX/g=="


def prepare(work):
    work.mkdir(parents=True, exist_ok=True)
    archive = work / "bsonlite-sdk-0.6.0-rc.3.tgz"
    if not archive.exists():
        temporary = archive.with_suffix(".partial")
        temporary.unlink(missing_ok=True)
        try:
            with urllib.request.urlopen(URL, timeout=120) as response, temporary.open("xb") as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 256 * 1024 * 1024:
                        raise RuntimeError("Legacy fixture exceeds its download limit")
                    output.write(chunk)
            temporary.rename(archive)
        finally:
            temporary.unlink(missing_ok=True)
    with archive.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha512").digest()
    if actual != base64.b64decode(INTEGRITY):
        raise RuntimeError("Previous SDK integrity mismatch; migration fixture was not loaded")
    if not (work / "package/package.json").exists():
        with tarfile.open(archive) as source:
            source.extractall(work, filter="data")
    print(work / "package")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    prepare(args.work.resolve())
