# BsonLite validation

## Current default profile: 9.0.4

The default core is now **0.7.0-alpha.0 / engine 9.0.4 / driver 7.7.0**.
This changes the actual source dependency and selected engine profile, rather
than only changing a version label. Ordinary `npm run build` produces the
native encrypted SDK in `dist/BsonLite.cjs`. Ordinary `npm run build:preview`
selects the same profile but explicitly reports that no native engine is
included. An installed driver version mismatch stops the build and requests
`npm ci`.

Tested code: `5ab0017339173049b25e16b3a404a16d3d664f3d`, on **2026-10-25**.
The [modern workflow](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40186712304)
passed its source, Windows and compiled WiredTiger storage jobs. The Windows
job builds with the ordinary default command and runs the final native suite
against `dist/BsonLite.cjs`; the compatibility copy under `dist-modern/` uses
the same SDK bytes. The resulting npm prerelease was prepared, packed,
installed and checksum/import verified on Windows.

| Required modern gate | Passed | Required skips/failures |
| --- | ---: | ---: |
| Actual source/native engine | 7 | 0 |
| Runtime, encrypted legacy migration and existing CLI | 3 | 0 |
| Default final embedded SDK | 9 | 0 |

These groups overlap. Source tests also verify the real default driver and
engine versions, reject an old-format store without changing its records,
and exercise the migration and CLI bridge. The separate storage job passed
the pinned WiredTiger write/reopen, ciphertext, wrong-key and tamper probes.
The explicit legacy profile remains available for compatibility and logical
migration; it is not the default.

Validated current artifacts (GitHub-reported ZIP digests):

- [Default native SDK and matching source](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40186712304/artifacts/12596299460): `e7a24ac6f3aa399667df42e165b455b0eefa6da2c530e52cc5724f6411ca010a`.
- [Prepared npm prerelease](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40186712304/artifacts/12596169663): `4af05fcd0ebd138a3491e0fef013d032c606ffdb05f2d515d51674397c2441df`.

The preceding default-profile artifact from commit `17b68fa` was also
downloaded and independently checked: SDK/source/report digests matched,
the primary and compatibility SDK copies were identical, and BsonLite-owned
guides in the corresponding-source archive used English names and text.
The final code commit above adds only the installed-driver build guard.
Core, SDK and Console install/publish guides now use English filenames and
instructions. No npm version was published by these validation workflows.

## Historical legacy baseline

The shared SDK source at the following earlier commit passed the complete legacy-engine Windows workflow on **2026-10-25**, including the actual encrypted engine, source SDK, final single-file SDK and earlier-format compatibility tests. This is backward-compatibility evidence for the existing 4.0.28 profile, not validation of the experimental 9.0.4 engine.

- Tested code commit: `696be4a7d3fc9e5105ab0bee1352b2e72ebb4f06`.
- Successful run: https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40179340903.
- Artifact: `BsonLite-native-Windows-x64-696be4a7d3fc9e5105ab0bee1352b2e72ebb4f06`, GitHub artifact ID `12594166012`.
- Artifact ZIP SHA-256: `0855fe49e79ee16d3b5c7677a4712e9c290205899e10d1ca0dc7fed015de7e6d`.
- Single-file SDK SHA-256: `e0de1a4661ee77a3b23936568ad3ad6f3257624c8e528e3e4f3e36b53972d2b3`.
- Matching modified-engine source SHA-256: `f3aa2c4df2adc16960bf8cdc3540ef85017fed27949af5cae485dc2eca3d9860`.

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

This run also verifies the two Windows regressions found during the engine port: concurrent consumers can publish identical engine-cache notices/metadata without an `EPERM` rename failure, and the Console adapter preserves the SDK's shared pending `start()` promise. The cache publication unit tests also reject mismatching bytes and exercise bounded sharing-lock retries. Fixture cleanup tolerates brief Windows sharing locks only after the required owned-process exit assertions; persistent locks still fail.

The final modern-upgrade commit `5137fbc92749f20679445657d504718446db4eab`
also passed the complete legacy workflow in
[run 40181496707](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496707).
The artifact hashes above identify the separately downloaded and verified
legacy baseline; the modern artifact below is a distinct distribution.

## Experimental modern-engine evidence

The modern engine passed its complete Windows workflow on **2026-10-25**:

- Tested commit: `5137fbc92749f20679445657d504718446db4eab`.
- Successful run: https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708.
- Engine: MongoDB Community 9.0.4 / WiredTiger 12.0.0 with BsonLite encryption; Node.js driver 7.7.0, libsodium 1.0.22, v143 static CRT and Windows SChannel.
- Experimental SDK: `0.7.0-alpha.0`; Windows x64 build 20348+, Node.js 20.19+.

| Required gate | Passed | Required skips/failures |
| --- | ---: | ---: |
| Real source/native engine cases | 7 | 0 |
| Runtime, encrypted 4.0-to-9.0 migration and existing CLI | 3 | 0 |
| Final embedded SDK, including isolated and concurrent consumers | 9 | 0 |

These groups overlap. The native gates cover real encrypted data/journals,
backup/restore, wrong-key rejection, incomplete-store protection, actual
aggregation spill and encryption-override refusal. Server refusal is checked
through the driver's preserved original error, and the engine must remain
usable with no partially created collection. Network/client failures cannot
count as successful enforcement.

The runtime migration case copies **141 records**, spanning the 64-document
and 4 MiB batch bounds. It preserves Long, Decimal128, Binary, ObjectId, Double,
Int32 and BSONRegExp values, validators, a unique index and a view; it verifies
BSON digests/counts and reopens the original store. The runtime suite also
checks window aggregation, journal-acknowledged writes after forced engine
termination, TLS/certificate/authentication rejection, restricted application
roles, credential rotation and the existing Console/CLI's BSON 6/7 bridge.

The source suite passed all 12 modern cases. The separate Linux storage job
compiled actual pinned WiredTiger 12 C source and passed its 2,048-record
write/reopen, data/journal ciphertext, wrong-key, oversized-key-frame and
tamper probes. These checks supplement the full Windows engine evidence.

Validated downloads:

- [Standalone SDK and matching source](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708/artifacts/12594725727), artifact ID `12594725727`.
- Native artifact ZIP SHA-256: `47e951406bedd45c747de221c9db0057f20a1ee6905ea1dd552611cc09c747ef`.
- Single-file SDK SHA-256: `d45c23428f98e641a479862fce16049185d09630ccbc424cc1d6789e455c7d9a`.
- Engine SHA-256: `69ff1cdb776b2c83444da85ff71af304b14a778d25f570da65faa075bda8e1f5`.
- Matching modified-engine source SHA-256: `24a1a5e73a6f0b429ed6266e09b417d76db9ac1f5a9ee98d50efde603e6b52e5`.
- [Prepared npm prerelease](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708/artifacts/12594269894), artifact ID `12594269894`.
- npm artifact ZIP SHA-256: `b1d13751593cd4fed995a9ff8cfff9a57f01d575f47b6f2426ced83cb5466bb7`.
- `bsonlite-sdk-0.7.0-alpha.0.tgz` SHA-256: `67d24c400aa21ffb4419ec97c53d77c03708090fd1e1f71386612737cb2a5cd5`.

The workflow prepared, packed, installed and checksum/import verified the npm
tarball on Windows. After download, both artifact ZIP digests, embedded SDK,
engine, matching source and all required JUnit report hashes were independently
matched to `validation.json`. The source archive's actual patch inputs reproduce
`patchSha256`, and its pinned libsodium archive hash also matches. The npm
tarball preserves the same SDK/source/evidence bytes and includes the original
reports under `validation/`. Its generated verifier also passed after local
extraction, including inert CJS/ESM imports. These local checks do not claim to
execute a Windows engine on Linux.

This is an **experimental validated prerelease**, prepared for the `next` tag.
It has not been published to npm by this workflow. The current published 0.6
package has separate legacy Windows interoperability evidence in
[run 40179501476](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/actions/runs/40179501476).
See the [modern usage/migration guide](native/modern/UPGRADE.md) and
[npm preparation/publishing guide](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/main/MODERN_ENGINE.md).

## Legacy native build evidence

The matching native source compiled and linked in run `39243938792`; the actual engine cipher self-test exited 0, runtime-DLL and engine-minidump import guards passed, and the exact modified-source archive was generated. Its compiled outputs were cached before SDK tests. The successful final run above reused that unchanged source-keyed cache, applied the UTF-8 process manifest, reran the actual cipher self-test, rebound the executable/source hashes, and passed all runtime stages before uploading an artifact. No Windows validation flag was fabricated.

The archived patcher plus four implementation files reproduce `native-engine.json`'s `patchSha256`. The accompanying modified-source archive includes the patched engine, build support, pinned libsodium source, UTF-8 manifest and notices. The CJS embeds the actual engine and reports `nativeReady:true` / `distributionMode:native-encrypted`. After download, the artifact ZIP hash, CJS/build-info checksums, modified-source hash and archived patch provenance were independently matched before preparing the starter ZIP.

A separate actual v141/static-CRT Windows probe passed UTF-8 narrow-fstream read/write in a Bengali path and `_mul128` arithmetic in run `39246830155`. The exact pinned upstream patch fixture passed and a second application was refused.

## Additional local evidence

Linux x64 validation covered the source SDK, unsupported-platform packaging behavior, real earlier-format MongoDB integration, and six real encrypted WiredTiger prototype integration cases. The Linux prototype lacks the MongoDB temporary-file hooks and is not a supported full-native customer distribution. After the engine pipe/log transport fix, all 18 earlier-format bundled integration cases passed locally. `npm audit --omit=dev --json` reported no known production npm dependency advisories on 2026-10-19; this does not audit the native engine.

On 2026-10-25, `npm audit --json` for the current core source and
`npm audit --omit=dev --json` for Console's production dependencies each
reported zero known npm advisories. This is dependency-advisory evidence,
not a native storage/cryptography audit.

## Remaining validation limits

This is a **release candidate**, not a production security certification. Clean Windows Home/Pro PCs, packaged Electron/installers, cross-PC restore, power-loss/disk-full durability and an independent storage/cryptography review remain pending. CI ran on Windows Server 2022, not every advertised compatible Windows version. Node.js is still required; this CJS is not a standalone EXE.

The legacy profile's MongoDB 4.0 is end-of-life. The modern profile uses its
separately pinned newer engine. Neither profile claims anti-rollback protection,
explicit key-slot erasure after fast termination, or confidentiality against
compromised runtimes, administrators, pagefiles, hibernation and OS crash dumps.
See `SECURITY.md` for the precise model and limitations.
