"""Package exact modified engine sources alongside the release binary."""
import argparse
from pathlib import Path
import tarfile
import io
import json

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / "deps.lock.json").read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    work = args.work.resolve()
    mongo = work / ("mongo-" + LOCK["mongo"]["commit"])
    output = ROOT / "build/BsonLite-native-engine-source.tar.gz"
    output.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    with tarfile.open(work / "mongo.tar.gz", "r:gz") as original, tarfile.open(output, "w:gz") as archive:
        for member in original:
            relative = Path(member.name).relative_to(mongo.name)
            file = mongo / relative
            member.name = "mongo/" + str(relative).replace("\\", "/")
            seen.add(relative.as_posix())
            if member.isfile():
                member.size = file.stat().st_size
                with file.open("rb") as content:
                    archive.addfile(member, content)
            else:
                archive.addfile(member)
        new = mongo / "src/third_party/wiredtiger/ext/encryptors/bsonlite"
        for file in sorted(new.iterdir()):
            archive.add(file, "mongo/" + file.relative_to(mongo).as_posix())
        for file in sorted(ROOT.rglob("*")):
            if file.is_file() and "build" not in file.relative_to(ROOT).parts and "__pycache__" not in file.parts:
                archive.add(file, "BsonLite-build-support/native/" + file.relative_to(ROOT).as_posix())
        archive.add(work / "sodium.tar.gz", "dependencies/libsodium-1.0.22.tar.gz")
        notes = b"BsonLite modified MongoDB 4.0.28 + WiredTiger source. Original licenses remain in mongo/. Build support and the pinned libsodium source accompany it. See native/README.md in the SDK project. Build host absolute paths in SConstruct/SConscript must be regenerated with native/patch_mongo.py on a fresh pinned source tree.\n"
        info = tarfile.TarInfo("BUILD_SOURCE_README.txt")
        info.size = len(notes)
        archive.addfile(info, io.BytesIO(notes))
    print(output)


if __name__ == "__main__":
    main()
