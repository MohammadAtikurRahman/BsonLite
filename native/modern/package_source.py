"""Ship matching SSPL source and the exact build inputs beside modern binaries."""
import argparse
import json
from pathlib import Path
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LOCK = json.loads((HERE / "deps.lock.json").read_text())


def package(work):
    mongo = work / ("mongo-" + LOCK["mongo"]["commit"])
    if not (mongo / ".bsonlite-native-patched").is_file():
        raise RuntimeError("The matching modified source is missing")
    output = ROOT / "native/build/modern/BsonLite-modern-engine-source.tar.gz"
    output.parent.mkdir(parents=True, exist_ok=True)

    def include(info):
        if any(part.startswith("bazel-") or part in (".git", "node_modules", "__pycache__") for part in Path(info.name).parts):
            return None
        if info.issym() or info.islnk():
            return None
        return info

    with tarfile.open(output, "w:gz") as archive:
        archive.add(mongo, arcname=mongo.name, filter=include)
        archive.add(work / "sodium.tar.gz", arcname="dependencies/libsodium-1.0.22.tar.gz")
        archive.add(ROOT / "native/modern", arcname="bsonlite/native/modern", filter=include)
        archive.add(ROOT / "native/src", arcname="bsonlite/native/src", filter=include)
        archive.add(ROOT / "LICENSE", arcname="bsonlite/LICENSE")
        archive.add(ROOT / "scripts/enable_windows_utf8.py", arcname="bsonlite/scripts/enable_windows_utf8.py")
        resource = ROOT / "assets/modern-win32-x64/engine-utf8.manifest"
        if resource.is_file():
            archive.add(resource, arcname="bsonlite/engine-utf8.manifest")
    notices = ROOT / "licenses/modern"
    notices.mkdir(exist_ok=True)
    (notices / "MongoDB-SSPL-1.0.txt").write_bytes((mongo / "LICENSE-Community.txt").read_bytes())
    (notices / "libsodium-LICENSE.txt").write_bytes((work / "libsodium-1.0.22/LICENSE").read_bytes())
    (notices / "MongoDB-THIRD-PARTY-NOTICES.txt").write_bytes((mongo / "distsrc/THIRD-PARTY-NOTICES").read_bytes())
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    package(args.work.resolve())
