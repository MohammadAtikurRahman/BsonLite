"""Promote build flags only after required real Windows test cases passed."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE_TESTS = [
    "real MongoDB queries, indexes and BSON values work with encrypted WiredTiger blocks",
    "native backup/restore preserves the data key and rewraps it for a new store identity",
    "a wrong protected data key fails authentication without resetting existing data",
    "an interrupted migration marker prevents use of a partial destination",
    "full native mode refuses the stock engine or a partial prototype before creating data",
    "rebuilt engine encrypts actual aggregation spill files",
    "rebuilt engine prevents per-collection plaintext encryption overrides",
]
RUNTIME_TESTS = [
    "modern encrypted engine preserves BSON, indexes, aggregation and records across restart",
    "actual previous encrypted SDK upgrades to 9.0 without changing BSON types or source records",
    "existing terminal CLI auto-discovers and queries the actual modern encrypted SDK",
]
FINAL_TESTS = SOURCE_TESTS + [
    "final Windows single-file artifact starts without developer binary paths or npm packages",
    "two standalone consumers safely share a fresh embedded engine cache",
]


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require_report(file, required):
    root = ET.parse(file).getroot()
    cases = root.findall(".//testcase")
    if any(c.find("failure") is not None or c.find("error") is not None for c in cases):
        raise RuntimeError("A runtime test failed in " + str(file))
    for name in required:
        matched = [c for c in cases if c.get("name") == name]
        if len(matched) != 1 or matched[0].find("skipped") is not None:
            raise RuntimeError("A required test did not execute successfully: " + name)
    return {"requiredPassed": len(required), "reportSha256": digest(file)}


def validate(phase, source, runtime, final=None):
    if sys.platform != "win32":
        raise RuntimeError("Only an actual Windows integration run can validate this engine")
    manifest_file = ROOT / "assets/modern-win32-x64/native-engine.json"
    manifest = json.loads(manifest_file.read_text())
    engine = manifest_file.parent / "mongod.exe"
    lock = json.loads((HERE / "deps.lock.json").read_text())
    if (manifest.get("version") != 2 or manifest.get("engineVersion") != lock["mongo"]["version"]
            or manifest.get("upstreamCommit") != lock["mongo"]["commit"]
            or manifest.get("engineSha256") != digest(engine)):
        raise RuntimeError("Runtime evidence does not match the pinned engine")
    reports = {"sourceNative": require_report(source, SOURCE_TESTS), "runtimeAndMigration": require_report(runtime, RUNTIME_TESTS)}
    source_archive = ROOT / "native/build/modern/BsonLite-modern-engine-source.tar.gz"
    manifest["sourceArchiveSha256"] = digest(source_archive)
    manifest["windowsIntegration"] = "passed"
    manifest["finalBundleIntegration"] = "pending"
    if phase == "final":
        if final is None:
            raise RuntimeError("Final bundled-consumer evidence is required")
        reports["finalNative"] = require_report(final, FINAL_TESTS)
        manifest["finalBundleIntegration"] = "passed"
    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n")
    if phase == "final":
        dist = ROOT / "dist-modern"
        evidence = {"version": 2, "status": "experimental-validated", "engineVersion": "9.0.4", "driverVersion": "7.7.0",
                    "repository": os.environ.get("GITHUB_REPOSITORY", "local"), "commit": os.environ.get("GITHUB_SHA", "local"),
                    "run": os.environ.get("GITHUB_SERVER_URL", "") + "/" + os.environ.get("GITHUB_REPOSITORY", "") + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", ""),
                    "engineSha256": digest(engine), "sdkSha256": digest(dist / "BsonLite.cjs"),
                    "modifiedEngineSourceSha256": manifest["sourceArchiveSha256"], "reports": reports,
                    "cleanWindowsDesktop": "not-tested", "independentSecurityAudit": "not-performed"}
        (dist / "validation.json").write_text(json.dumps(evidence, indent=2) + "\n")
        files = ["BsonLite.cjs", "build-info.json", "validation.json"]
        (dist / "SHA256SUMS.txt").write_text("".join(digest(dist / n) + "  " + n + "\n" for n in files))
    print(json.dumps({"phase": phase, "reports": reports}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["source", "final"], required=True)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--final", type=Path)
    args = parser.parse_args()
    validate(args.phase, args.source, args.runtime, args.final)
