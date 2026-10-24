# BsonLite 0.6.0-rc.1 validation

The current shared SDK source passed the complete legacy-engine Windows workflow on **2026-10-24**, including the actual encrypted engine, source SDK, final single-file SDK and earlier-format compatibility tests. This is backward-compatibility evidence for the existing 4.0.28 profile, not validation of the experimental 9.0.4 engine.

- Tested code commit: `82f407392a996ec031c818d1a491bdeea3646c97`.
- Successful run: https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40123385230.
- Artifact: `BsonLite-native-Windows-x64-82f407392a996ec031c818d1a491bdeea3646c97`, GitHub artifact ID `12572412976`.
- Artifact ZIP SHA-256: `e23e3eb19155999280253d14469c72b0dc5986728a22537c241a37720da54643`.
- Matching modified-engine source SHA-256: `c36f14d817e3a3dff09d981a75985eccda68b6a9931a5179ee7c08db9da598f6`.

Documentation-only commits can follow this tested commit. The artifact's `validation.json` records the exact tested code/run and modified-engine source hash; `SHA256SUMS.txt` records the CJS and build-info hashes. A source-preview bundle is a different artifact and contains no engine.

## Windows results

Runner: Windows Server 2022 x64, Node.js 24. Engine: pinned MongoDB 4.0.28 / WiredTiger 3.1.1 with built-in BsonLite encryption and libsodium 1.0.22. Native compiler profile: v141 14.16, Windows SDK 10.0.19041.0, static C runtime, Windows SChannel TLS.

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Unit, security, compiled crypto and Windows helpers | 38 | 0 | 0 |
| Focused parent-exit and HTTP starter preflight | 2 | 0 | 0 |
| Source SDK with the actual native engine | 8 | 0 | 2 |
| Final artifact packaging | 2 | 0 | 1 |
| Final single-file native SDK integration | 10 | 0 | 0 |
| Final single-file earlier-format integration | 18 | 0 | 0 |

The two source-suite skips require the final embedded bundle and passed in the subsequent final native suite. The packaging skip exercises unsupported platforms and does not apply on its supported Windows runner; it passed on Linux. The preflight repeats the two lifecycle cases before the longer suites. Counts across these rows overlap and are not presented as distinct tests.

The final native suite exercised real CRUD/BSON values, indexes and reopening, encrypted WiredTiger data and journals, actual aggregation spill files in Unicode paths, rejection of per-collection plaintext overrides, wrong protected-key refusal without data reset, encrypted native backup/restore, BSON-preserving migration and views, interrupted-migration refusal, full-native capability gating, isolated consumers without npm packages/developer binary paths, and concurrent extraction into a fresh engine cache.

The final earlier-format suite exercised authenticated connections and account rotation, rejection of missing/incorrect TLS certificates and hostnames, independent stores/ports, forced parent termination with engine/helper cleanup and persisted data, import/require in an empty consumer directory, encrypted backups and tamper rejection, path-traversal rejection, original-preserving upgrade, identity/lock protections, Unicode paths and the actual HTTP starter lifecycle. Both parent-exit cases also require the owned Windows processes to exit before fixture removal.

This run also verifies the two Windows regressions found during the engine port: concurrent consumers can publish identical engine-cache notices/metadata without an `EPERM` rename failure, and the Console adapter preserves the SDK's shared pending `start()` promise. The cache publication unit tests also reject mismatching bytes and exercise bounded sharing-lock retries.

## Experimental modern-engine evidence

The modern source profile selects MongoDB Community 9.0.4, WiredTiger 12.0.0 and Node.js driver 7.7.0. Source tests cover binary BSON conversion between driver majors, incomplete-migration protection, original-store preservation, collation review and the existing Console's typed query bridge. The local source suite passed all 12 cases; it cannot establish that a Windows engine works.

The separate storage job compiles the actual pinned WiredTiger C source and BsonLite encryptor. It passed a 2,048-record write/reopen probe, data/journal encryption, wrong-key rejection, oversized-key-frame rejection and tampered-ciphertext rejection. [Run 40117415181](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40117415181) records successful source and storage jobs. The full MongoDB C++ Windows build and its runtime/migration gates were still pending when this evidence was recorded.

Only a successful modern Windows workflow can produce the experimental embedded SDK and npm tarball. It must execute seven required source/native cases, three migration/runtime/CLI cases and nine final embedded cases without skipping any required case. These groups overlap. The final `validation.json` binds the engine, SDK, matching source and exact test-report hashes to the commit/run. See [the modern workflow](https://github.com/MohammadAtikurRahman/BsonLite/actions/workflows/modern-engine.yml).

The published npm package remains separate from this source upgrade. The SDK repository's [Windows packed-package/Console run 40085137332](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/actions/runs/40085137332) passed for the preserved legacy package. The Console promise fix's [Windows test/build run 40123265157](https://github.com/MohammadAtikurRahman/BsonLite-Console/actions/runs/40123265157) also passed. Neither is a substitute for modern-engine runtime evidence.

## Native build evidence

The matching native source compiled and linked in run `39243938792`; the actual engine cipher self-test exited 0, runtime-DLL and engine-minidump import guards passed, and the exact modified-source archive was generated. Its compiled outputs were cached before SDK tests. The successful final run above reused that unchanged source-keyed cache, applied the UTF-8 process manifest, reran the actual cipher self-test, rebound the executable/source hashes, and passed all runtime stages before uploading an artifact. No Windows validation flag was fabricated.

The archived patcher plus four implementation files reproduce `native-engine.json`'s `patchSha256`. The accompanying modified-source archive includes the patched engine, build support, pinned libsodium source, UTF-8 manifest and notices. The CJS embeds the actual engine and reports `nativeReady:true` / `distributionMode:native-encrypted`. After download, the artifact ZIP hash, CJS/build-info checksums, modified-source hash and archived patch provenance were independently matched before preparing the starter ZIP.

A separate actual v141/static-CRT Windows probe passed UTF-8 narrow-fstream read/write in a Bengali path and `_mul128` arithmetic in run `39246830155`. The exact pinned upstream patch fixture passed and a second application was refused.

## Additional local evidence

Linux x64 validation covered the source SDK, unsupported-platform packaging behavior, real earlier-format MongoDB integration, and six real encrypted WiredTiger prototype integration cases. The Linux prototype lacks the MongoDB temporary-file hooks and is not a supported full-native customer distribution. After the engine pipe/log transport fix, all 18 earlier-format bundled integration cases passed locally. `npm audit --omit=dev --json` reported no known production npm dependency advisories on 2026-10-19; this does not audit the native engine.

## Remaining validation limits

This is a **release candidate**, not a production security certification. Clean Windows Home/Pro PCs, packaged Electron/installers, cross-PC restore, power-loss/disk-full durability and an independent storage/cryptography review remain pending. CI ran on Windows Server 2022, not every advertised compatible Windows version. Node.js is still required; this CJS is not a standalone EXE.

MongoDB 4.0 is end-of-life. No upstream server maintenance, anti-rollback protection, explicit key-slot erasure after the engine's fast termination, or confidentiality against compromised runtimes, administrators, pagefiles, hibernation and OS crash dumps is claimed. See `SECURITY.md` for the precise model and limitations.
