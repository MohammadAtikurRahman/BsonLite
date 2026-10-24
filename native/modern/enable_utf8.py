"""Verify and embed the modern engine's real UTF-8 Windows resource."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location("legacy_resource_helpers", ROOT / "scripts/enable_windows_utf8.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
LOCK = json.loads((HERE / "deps.lock.json").read_text())


def enable(engine, manifest):
    if sys.platform != "win32":
        raise RuntimeError("The actual Windows resource tool is required")
    metadata = json.loads(manifest.read_text())
    if (metadata.get("version") != 2 or metadata.get("engineVersion") != LOCK["mongo"]["version"]
            or metadata.get("upstreamCommit") != LOCK["mongo"]["commit"]
            or metadata.get("engineSha256") != helpers.digest(engine)):
        raise RuntimeError("The modern engine does not match its build manifest")
    tool = helpers.manifest_tool()
    with tempfile.TemporaryDirectory(prefix="bsonlite-modern-utf8-") as folder:
        original, merged, verified = [Path(folder) / n for n in ("original.xml", "merged.xml", "verified.xml")]
        subprocess.run([tool, "-nologo", "-inputresource:" + str(engine) + ";#1", "-out:" + str(original)], check=True)
        tree = ET.parse(original)
        critical = helpers.critical_settings(tree.getroot())
        active = tree.find(".//{" + helpers.UTF8 + "}activeCodePage")
        if active is None or active.text != "UTF-8":
            application = tree.getroot().find("{" + helpers.ASM3 + "}application")
            if application is None:
                application = ET.SubElement(tree.getroot(), "{" + helpers.ASM3 + "}application")
            settings = application.find("{" + helpers.ASM3 + "}windowsSettings")
            if settings is None:
                settings = ET.SubElement(application, "{" + helpers.ASM3 + "}windowsSettings")
            if active is None:
                active = ET.SubElement(settings, "{" + helpers.UTF8 + "}activeCodePage")
            active.text = "UTF-8"
            tree.write(merged, encoding="utf-8", xml_declaration=True)
            subprocess.run([tool, "-nologo", "-manifest", str(merged), "-outputresource:" + str(engine) + ";#1"], check=True)
        subprocess.run([tool, "-nologo", "-inputresource:" + str(engine) + ";#1", "-out:" + str(verified)], check=True)
        actual = ET.parse(verified)
        active = actual.find(".//{" + helpers.UTF8 + "}activeCodePage")
        if active is None or active.text != "UTF-8" or helpers.critical_settings(actual.getroot()) != critical:
            raise RuntimeError("Windows code page/security settings were not verified")
        resource = verified.read_bytes()
    result = subprocess.run([str(engine), "--bsonlite-native-self-test"], capture_output=True, text=True, check=True)
    probe = json.loads(result.stdout)
    if probe.get("selfTest") is not True or probe.get("engineVersion") != LOCK["mongo"]["version"]:
        raise RuntimeError("The modified executable failed its real cipher probe")
    (engine.parent / "engine-utf8.manifest").write_bytes(resource)
    metadata.update(engineSha256=helpers.digest(engine), windowsCodePage="UTF-8", minimumWindowsBuild=20348,
                    resourceManifestSha256=hashlib.sha256(resource).hexdigest(), windowsIntegration="pending")
    manifest.write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("engine", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    enable(args.engine.resolve(), args.manifest.resolve())
