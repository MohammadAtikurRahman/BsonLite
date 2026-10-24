"""Download and verify the immutable modern-engine inputs, without legacy Python 2."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / "deps.lock.json").read_text())


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            h.update(data)
    return h.hexdigest()


def prepare(work):
    work.mkdir(parents=True, exist_ok=True)
    result = {}
    for name, spec in LOCK.items():
        archive = work / (name + ".tar.gz")
        if not archive.exists():
            temporary = archive.with_suffix(".partial")
            temporary.unlink(missing_ok=True)
            try:
                request = urllib.request.Request(spec["url"], headers={"User-Agent": "BsonLite-modern-builder"})
                with urllib.request.urlopen(request, timeout=120) as response, temporary.open("xb") as output:
                    total = 0
                    while data := response.read(1024 * 1024):
                        total += len(data)
                        if total > 1024 * 1024 * 1024:
                            raise RuntimeError("Dependency archive exceeds the 1 GiB limit")
                        output.write(data)
                temporary.rename(archive)
            finally:
                temporary.unlink(missing_ok=True)
        if digest(archive) != spec["sha256"]:
            raise RuntimeError(f"{name} SHA-256 mismatch; no unverified source was extracted")
        directory = work / ("mongo-" + spec["commit"] if name == "mongo" else "libsodium-" + spec["version"])
        if not directory.exists():
            with tarfile.open(archive) as source:
                source.extractall(work, filter="data")
        result[name] = str(directory.resolve())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=HERE.parent / "build/modern/dependencies")
    args = parser.parse_args()
    print(json.dumps(prepare(args.work.resolve())))
