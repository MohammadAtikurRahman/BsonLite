# BsonLite — pause checkpoint (2026-10-19)

ব্যবহারকারীর অনুরোধে কাজ এখানে থামানো হয়েছে। পরেরবার এখান থেকেই চালাতে হবে; নতুন করে project শুরু করতে হবে না।

## Saved state

- Private repository: https://github.com/MohammadAtikurRahman/BsonLite
- Main source commit at checkpoint: `88e9459344111f52d95a6162295ad71fb67b4da0`.
- This checkpoint branch contains additional UTF-8 packaging work; it is a draft, not a finished Windows release. No new build should start from this checkpoint commit.
- MongoDB 4.0.28, libsodium 1.0.22, driver 6.16.0 remain pinned. Native WiredTiger encryption, protected key vault, TLS, encrypted logs, backup/restore, migration, shared engine-cache handling and tests are implemented.
- Committed SDK checks passed on Windows. Latest local unit/security/crypto-probe run: 30 passed, 1 Windows-only helper test skipped. Real Linux prototype integration: 6 passed, 4 full-Windows cases skipped. Production npm audit reported 0 known vulnerabilities on 2026-10-19.
- A final encrypted Windows single-file artifact has NOT passed all tests or been delivered. Existing source-preview `BsonLite.cjs` must not be mistaken for that artifact.

## Latest actual Windows blocker

Run: https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/39221294949

Latest attempt job: `117988069280`, completed with failure at native compilation.

```text
src/mongo/platform/overflow_arithmetic.h(74): error C3861: '_mul128': identifier not found
build/opt/mongo/client/replica_set_monitor_stats.obj failed: Error 2
```

Earlier actual build problems (pywin32, Windows target name, v141 ATL headers, unsupported DataCorruption enum) were corrected. The native builder now compiles modified native translation units and WiredTiger first. Inspect the exact pinned source/toolchain for the new intrinsic error; do not reset data or bypass compiler/security validation.

## Draft work saved on this branch

`scripts/enable_windows_utf8.py` prepares an engine UTF-8 process manifest through Windows SDK mt.exe after restoring/saving the C++ build cache. The old sorter uses narrow file streams; this packaging step is intended to support Unicode project/profile paths without changing the customer's system locale. It preserves execution-level/OS manifest settings, rechecks the real engine cipher self-test, updates the actual binary hash, adds corresponding build support/notices to the source archive, and resets Windows integration to pending. Python/JS syntax was checked. Actual Windows PE processing and Unicode spill behavior still require CI proof.

Workflow/build guards, minimum Windows build 18362, and developer documentation are drafted here. These SDK/packaging files do not change the native C++ cache key. Do not label this draft validated or final.

## Resume order

1. Read this checkpoint, inspect the latest job log and fix the `_mul128` compiler blocker against the pinned source. Add that affected translation unit to early native compilation if appropriate.
2. Review/test the UTF-8 packaging draft, run the actual full Windows build, and preserve usable compiled outputs. Do not keep cancelling a long build for SDK-only changes.
3. Require real data/journal encryption, wrong-key refusal, backup/restore, BSON-preserving migration, actual encrypted sort spills, plaintext-override enforcement, the embedded single-file consumer and parallel cache consumer tests to pass. Test the final bundled CJS and earlier-format compatibility.
4. Update release version/docs/provenance only to match observed results. Retrieve and verify the compiled artifact with matching modified-engine source and notices. Replace the old preview download with the actual validated CJS and runtime ZIP.
5. Clean Windows Home/Pro, packaged Electron, power-loss behavior and independent security review remain unverified; MongoDB 4.0 is an unsupported upstream branch. Do not claim bulletproof or independently audited security.

No credentials or data keys belong in this checkpoint. Existing Portable-MongoDB repository and user database data were not reset.
