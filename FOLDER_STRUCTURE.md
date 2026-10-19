# BsonLite native preview structure

| Path | Purpose |
| --- | --- |
| `src/` | Node.js supervisor, API, protected vault, native bridge, migration, backups and TLS |
| `native/src/bsonlite_crypto.c` | libsodium authenticated-encryption bridge and protected stdin key handoff |
| `native/src/bsonlite_wiredtiger.c` | WiredTiger 3.1.1 encryptor ABI |
| `native/src/mongo_hooks.inc` | Encrypted RemoveSaver stream used by the engine patch |
| `native/patch_mongo.py` | Exact-source patch, built-in registration, temp hooks and table/index enforcement |
| `native/deps.lock.json` | Pinned developer source/tool downloads and SHA-256 values |
| `native/build_windows.ps1` | Native Windows build orchestration |
| `.github/workflows/native-windows.yml` | Full Windows engine/SDK build and validation |
| `native/build_linux.py` | Limited Linux prototype builder for a supplied MongoDB 4.0.28 binary |
| `native/package_source.py` | Matching modified source archive for a binary release |
| `scripts/Publish-GitHub.ps1` | One-time developer helper to create an empty new repo and push `main` |
| `NEW_REPOSITORY_BN.md` | New repository and automatic Windows build instructions |
| `BsonLite-repository.bundle` | Download-only Git history; generated files stay out of source commits |
| `dist/BsonLite.cjs` | In this download: source-only preview; final CI artifact: embedded encrypted engine |
| `test/native*.test.cjs` | Cipher, keys, logs, real storage, migration, restore and native release tests |

The final consumer stores records/indexes/journals in `Database/data/`, ciphertext diagnostics in `Database/logs/bsonlite.log.enc`, and public identity/cipher information in `Database/bsonlite.json`. `migration.json` blocks use of incomplete migration destinations.

Engine/cache, DPAPI vault and TLS sessions remain outside the project at `%LOCALAPPDATA%/BsonLite`. The database key is never intentionally written as a raw key file. Physical filenames/headers remain visible. A final Node.js consumer needs the built CJS and its own app code; a desktop customer needs the app with its runtime packaged.
