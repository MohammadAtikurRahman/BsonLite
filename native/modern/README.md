# MongoDB 9.0.4 engine upgrade

This is an experimental build path. The published 0.6 SDK and existing
MongoDB 4.0.28 stores are unchanged. No 9.0 customer artifact is validated merely
by applying the source patch or importing the source preview.

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

## Build on Windows

Requirements: Windows x64, PowerShell 7, Python 3.13, Node.js 24, Visual Studio
2022 with v143 C++ tools and a Windows SDK. The build uses upstream Bazel with
local execution, Community-only components, a static CRT and Windows SChannel.
No Python 2 or VC90 installation is used for this build path.

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
until the entire release validation has actually passed; do not edit this flag
to bypass validation. The separate experimental workflow uploads evidence only
after its steps pass. It does not publish an npm version or a GitHub Release.

## Source review without the engine

```sh
npm ci
npm run build:modern:preview
npm run test:modern
```

This generates `dist-modern/BsonLite.cjs` with the new driver and API, but no
native engine. A source preview cannot create an encrypted customer database.
Normal `npm run build` still selects the legacy profile.

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

## Licensing

The engine remains SSPL-1.0. BsonLite's MIT wrapper does not relicense it.
`package_source.py` includes the matching modified MongoDB tree, libsodium
source, patch/build scripts, the resource helper and licence. Keep this source
download and the matching engine notices with every distributed engine binary.
