# MongoDB 9.0.4 engine upgrade

This is an experimental build path. The published 0.6 SDK and existing
MongoDB 4.0.28 stores are unchanged. No 9.0 customer artifact is validated merely
by applying the source patch or importing the source preview.

[বাংলায় ব্যবহার ও পুরোনো database upgrade](UPGRADE_BN.md)

## Pinned inputs

- MongoDB r9.0.4, commit `246de92935f8636f4f90889d418b31ae70dbaafd`.
- WiredTiger 12.0.0 supplied by that exact MongoDB source archive.
- libsodium 1.0.22, the same XChaCha20-Poly1305 primitive as the existing engine.
- Node.js driver 7.7.0 for the modern SDK; Node.js 20.19+ is required.

`deps.lock.json` pins the actual source archive hashes. `patch_mongo.py` checks
all replacement sites before changing upstream files, registers the built-in
encryptor before recovery, ports the new DataRange temporary-file API, forces
collection/index encryption after user configuration, and disables the engine's
own plaintext minidump writer. These changes need actual full-engine testing.
The shared WiredTiger open configuration also encrypts the new secondary spill
database, including its metadata and journal.

## Build on Windows

Requirements: Windows x64, PowerShell 7, Python 3.13, Node.js 24, Visual Studio
2022 with v143 C++ tools and a Windows SDK. The build uses upstream Bazel with
local execution, Community-only components, a static CRT and Windows SChannel.
No Python 2 or VC90 installation is used for this build path.

The builder uses a short Bazel output root (`C:\b` on a normal Windows install)
because MSVC still limits generated object-file paths. Override it with
`-BazelRoot D:\b` when needed; the directory must be short and writable. The
preflight compiles the longest-path server target as well as the patched C++
libraries before starting the full build.

```powershell
./native/modern/build_windows.ps1
npm ci
npm run build:modern:preview
$env:BSONLITE_MODERN_BINARY = "$PWD/assets/modern-win32-x64/mongod.exe"
$env:BSONLITE_MODERN_MANIFEST = "$PWD/assets/modern-win32-x64/native-engine.json"
npm run test:modern-integration
```

The Windows manifest is modified and re-extracted with the real Windows SDK
resource tool before its checksum is recorded. Engine self-tests, version and
DLL/dump imports must pass. The manifest remains `windowsIntegration: pending`
until the required source-engine and migration/CLI JUnit cases pass.
`validate_release.py` checks exact named cases and rejects skipped or failed
tests. A second gate requires the final embedded SDK and isolated concurrent
consumers. Do not edit validation flags to bypass either gate. The experimental
workflow uploads the customer artifact only after both gates pass. It does not
publish an npm version or a GitHub Release.

After final native validation, the workflow uses the pinned Bsonlite-SDK
preparation script to produce, pack, install and verify the actual npm
prerelease. Its separate `BsonLite-modern-npm-<commit>` artifact contains the
tarball, validation record and checksum. Publishing that tarball is a separate
maintainer action; its default tag is `next`. Matching engine source and the
integrated Console adapter are included in the package.

## Source review without the engine

```sh
npm ci
npm run build:modern:preview
npm run test:modern
```

For the cross-version Console/CLI test, check out BsonLite Console at commit
`f118504cc89f457f4039c6a8757740e86e522331`, run `npm ci --ignore-scripts`
there, and set `BSONLITE_CONSOLE_REPO` to that checkout before `test:modern`.
The workflow runs this test with the existing Console's BSON 6 client and the
modern SDK's BSON 7 driver through the authenticated EJSON bridge.

This generates `dist-modern/BsonLite.cjs` with the new driver and API, but no
native engine. A source preview cannot create an encrypted customer database.
Normal `npm run build` still selects the legacy profile.

The modern engine requires native encryption. Its `auto` and `required` SDK
policies select full native encryption; `none` and partial prototypes are
rejected before a store is created. Legacy administration policies retain
their existing behavior in the 4.0 SDK.

## Release gates

Promotion requires full Windows data, journal and temporary-spill checks,
wrong-key/tamper failures, Unicode paths, shutdown/crash and backup/restore
coverage, logical migration from the previous encrypted SDK, Console/CLI typed
query interoperability and final bundled-consumer validation. Supported OS/CPU
and memory requirements must be measured on real target machines. The modern
Windows profile starts at build 20348 (Server 2022 / Windows 11); Windows 10
compatibility is not promised.

Old 4.0 data directories and physical backups must not be opened by the new
engine. Preserve them and use a separately tested logical migration into a new
store. Copying metadata or changing its version is not migration.

## Upgrade an existing encrypted store

Close all applications using the original store and retain an encrypted backup,
the original directory and its matching protected vault. Once the modern engine
has passed the release gates, use the **previous** SDK to read the old data:

```js
const previous = require('./BsonLite-previous.cjs');
const modern = require('./BsonLite-modern.cjs');

const report = await modern.upgrade({
  sourceSDK: previous,
  sourceDirectory: './Database',
  directory: './Database9'
});
console.log(report);
```

The destination must not exist. The SDK reserves it as incomplete before
copying, preserves BSON through binary serialization, recreates collection
options/indexes/views, and compares document counts and BSON digests. A failed
or interrupted destination remains blocked. The source records are retained.
Non-simple collations require explicit `allowCollationUpgrade: true` because
the new engine's ICU version can change comparison and unique-index behavior.

The equivalent developer command is:

```sh
node scripts/upgrade.cjs --source-sdk ./BsonLite-previous.cjs --modern-sdk ./dist-modern/BsonLite.cjs --source ./Database --directory ./Database9
```

Source previews additionally require the matching `--binary` and
`--native-manifest`. `prepare_legacy.py` downloads the integrity-pinned published
`bsonlite-sdk@0.6.0-rc.3` solely as the Windows migration test fixture.

## Independent storage test

`test_wiredtiger.py` compiles the actual pinned WiredTiger C source and BsonLite
extension against the pinned static libsodium library. Its probe writes and
reopens 2,048 records, checks encrypted data/journal blocks, rejects wrong keys,
oversized key frames and altered ciphertext. Its report identifies MongoDB C++
and Windows validation separately; this test alone cannot validate a customer
engine.

## Licensing

The engine remains SSPL-1.0. BsonLite's MIT wrapper does not relicense it.
`package_source.py` includes the matching modified MongoDB tree, libsodium
source, patch/build scripts, the resource helper and licence. Keep this source
download and the matching engine notices with every distributed engine binary.
