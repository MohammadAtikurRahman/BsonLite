# BsonLite 0.6.0-preview.2 validation

Local validation on 2026-10-19, Linux x64, Node.js 24.19.0. Fresh pinned npm dependency installation. Real MongoDB 4.0.28 Ubuntu 18.04 binary with its private OpenSSL 1.1 runtime; actual libsodium 1.0.22 built from the pinned verified source archive.

| Check | Local result |
| --- | --- |
| Unit/security/native crypto suite | 30 passed, 0 failed/skipped |
| Source-preview packaging | 3 passed, 0 failed/skipped |
| Earlier-format bundled SDK integration | 18 passed in one full run, 0 failed/skipped |
| Real native WiredTiger prototype integration through the new bundle | 6 passed, 3 full-engine/Windows-only tests skipped |
| Exact upstream patch application | Complete pinned source tree patched, record/index enforcement present, repeat refused; provenance includes patcher logic |
| Matching modified-source package | Generated and inspected a 53,221,803-byte archive containing engine changes, native code, build support and pinned libsodium source |
| Developer dependency preparation | Download hashes checked; archive/wheel extraction exercised; pinned VC90 installer downloaded/hashed but not executed on Linux |
| Source/configuration syntax | 36 JavaScript files, native Python source parsing and both workflow YAML files passed |

57 distinct automated Node test cases passed. Three full-engine/Windows checks remain skipped locally: actual encrypted aggregation spills, enforced collection plaintext-override rejection, and a final Windows CJS without developer paths. Native Windows C/C++ compilation and linking have not run. Patcher success is not compiler validation.

Native integration exercised real queries, aggregate math, unique/text indexes, date/ObjectId persistence, encrypted WiredTiger blocks and journals, ciphertext process logs, wrong protected-key refusal, native backup restore with a new store identity, BSON numeric/regex-preserving migration and views, incomplete-migration refusal and full-native capability gating. The Linux extension deliberately reports verified:false because it lacks MongoDB temporary-file hooks.

The earlier circular migration dependency remains fixed using dependency injection. The new bundle passed startup, native migration and the complete earlier-format integration suite in this run. No failures are knowingly retained in the locally exercised feature set.

The delivered CJS is a source preview. It contains no stock or rebuilt engine and cannot start a default customer database. Its import/require behavior, supervisor error propagation and absence of a fake native payload were tested. A final Windows CJS is only produced after the supplied Windows workflow passes.

A separate local Git repository has been initialized on `main`, and the private GitHub repository `MohammadAtikurRahman/BsonLite` has now been created through the authorized browser session. Source upload and the first Windows run are being prepared. No Windows artifact has been produced yet. The workflow starts on `main` push and records checksums plus commit/run provenance only after all checks pass. The Windows builder and publishing helper themselves have not been executed on Windows.

Not claimed: native Windows validation, clean Windows Home/Pro PC validation, standalone EXE/installer, packaged Electron validation, power-loss/disk-full durability, OS pagefile/crash-dump confidentiality, anti-rollback protection, or independent cryptography/storage audit.
