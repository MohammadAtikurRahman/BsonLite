"""Give the cached Windows engine a UTF-8 process manifest, then rebind its hash.

Developer/CI-only packaging step. Customer PCs do not install or run mt.exe.
Microsoft documents this process setting for Windows 10 version 1903 and later.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
ASM = "urn:schemas-microsoft-com:asm.v1"
ASM3 = "urn:schemas-microsoft-com:asm.v3"
UTF8 = "http://schemas.microsoft.com/SMI/2019/WindowsSettings"
ET.register_namespace("", ASM)
ET.register_namespace("asmv3", ASM3)
ET.register_namespace("ws2019", UTF8)


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def manifest_tool():
    known = shutil.which("mt.exe")
    if known:
        return known
    kits = Path(os.environ["ProgramFiles(x86)"]) / "Windows Kits/10/bin"
    versions = [p for p in kits.glob("*/x64/mt.exe")
                if all(part.isdecimal() for part in p.parent.parent.name.split("."))]
    if not versions:
        raise RuntimeError("The CI/developer host needs the Windows SDK manifest tool.")
    return str(max(versions, key=lambda p: tuple(map(int, p.parent.parent.name.split(".")))))


def critical_settings(root):
    return sorted((element.tag, tuple(sorted(element.attrib.items())))
                  for element in root.iter()
                  if element.tag.rsplit("}", 1)[-1] in ("requestedExecutionLevel", "supportedOS"))


def add_build_support(archive_path, engine_manifest):
    additions = {
        "BsonLite-build-support/scripts/enable_windows_utf8.py": Path(__file__).read_bytes(),
        "BsonLite-build-support/engine-utf8.manifest": engine_manifest,
        "BsonLite-build-support/WINDOWS_UTF8_README.txt": (
            "After native/build_windows.ps1, run python scripts/enable_windows_utf8.py.\n"
            "This developer-only Windows SDK mt.exe step preserves the engine's security/OS settings, "
            "adds activeCodePage=UTF-8, rebinds native-engine.json to the resulting binary hash, "
            "and requires fresh Windows integration tests before bundling.\n"
            "Minimum customer OS: Windows 10 version 1903 (build 18362), Windows 11, "
            "or a compatible Windows Server release. No system locale change is required.\n"
            "Reference: https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page\n"
        ).encode("utf-8"),
    }
    additions["BsonLite-build-support/native/README.md"] = (ROOT / "native/README.md").read_bytes()
    # These notices also make the engine-only build support usable without a
    # previously created SDK checkout's licenses directory.
    for file in (ROOT / "licenses").glob("*"):
        if file.is_file() and file.suffix.lower() in (".txt", ".md"):
            additions["BsonLite-build-support/licenses/" + file.name] = file.read_bytes()
    temporary = archive_path.with_name(archive_path.name + ".utf8.tmp")
    try:
        with tarfile.open(archive_path, "r:gz") as source, tarfile.open(temporary, "w:gz") as target:
            for member in source:
                if member.name not in additions:
                    target.addfile(member, source.extractfile(member) if member.isfile() else None)
            for name, content in sorted(additions.items()):
                member = tarfile.TarInfo(name)
                member.size = len(content)
                member.mode = 0o644
                target.addfile(member, io.BytesIO(content))
        os.replace(temporary, archive_path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, default=ROOT / "assets/native-win32-x64/mongod.exe")
    parser.add_argument("--native-manifest", type=Path, default=ROOT / "assets/native-win32-x64/native-engine.json")
    parser.add_argument("--source-archive", type=Path, default=ROOT / "native/build/BsonLite-native-engine-source.tar.gz")
    args = parser.parse_args()
    if sys.platform != "win32":
        raise RuntimeError("The actual Windows manifest tool is required; no simulated success is recorded.")
    metadata = json.loads(args.native_manifest.read_text(encoding="utf-8"))
    if metadata.get("mode") != "builtin" or metadata.get("engineSha256") != digest(args.engine):
        raise RuntimeError("The cached engine does not match its native build manifest.")
    tool = manifest_tool()
    with tempfile.TemporaryDirectory(prefix="bsonlite-utf8-") as folder:
        original, merged, verified = (Path(folder) / name for name in ("original.manifest", "merged.manifest", "verified.manifest"))
        subprocess.run([tool, "-nologo", "-inputresource:" + str(args.engine) + ";#1", "-out:" + str(original)], check=True)
        tree = ET.parse(original)
        before = critical_settings(tree.getroot())
        active = tree.find(".//{" + UTF8 + "}activeCodePage")
        if active is None or active.text != "UTF-8":
            application = tree.getroot().find("{" + ASM3 + "}application")
            if application is None:
                application = ET.SubElement(tree.getroot(), "{" + ASM3 + "}application")
            settings = application.find("{" + ASM3 + "}windowsSettings")
            if settings is None:
                settings = ET.SubElement(application, "{" + ASM3 + "}windowsSettings")
            if active is None:
                active = ET.SubElement(settings, "{" + UTF8 + "}activeCodePage")
            active.text = "UTF-8"
            tree.write(merged, encoding="utf-8", xml_declaration=True)
            subprocess.run([tool, "-nologo", "-manifest", str(merged), "-outputresource:" + str(args.engine) + ";#1"], check=True)
        subprocess.run([tool, "-nologo", "-inputresource:" + str(args.engine) + ";#1", "-out:" + str(verified)], check=True)
        actual = ET.parse(verified)
        active = actual.find(".//{" + UTF8 + "}activeCodePage")
        if active is None or active.text != "UTF-8" or critical_settings(actual.getroot()) != before:
            raise RuntimeError("UTF-8 process manifest was not verified or changed security/OS settings.")
        probe = subprocess.run([str(args.engine), "--bsonlite-native-self-test"], check=True, capture_output=True, text=True, encoding="utf-8")
        if json.loads(probe.stdout).get("selfTest") is not True:
            raise RuntimeError("The repackaged engine failed its real cipher self-test.")
        manifest_bytes = verified.read_bytes()
        add_build_support(args.source_archive, manifest_bytes)
    metadata.update(engineSha256=digest(args.engine), windowsCodePage="UTF-8", minimumWindowsBuild=18362,
                    resourceManifestSha256=hashlib.sha256(manifest_bytes).hexdigest(), windowsIntegration="pending")
    args.native_manifest.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("UTF-8 engine resource verified; native binary/source hashes rebound. Full Windows tests are still required.")


if __name__ == "__main__":
    main()
