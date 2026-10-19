# Native encrypted engine build

Status: implementation + verified Linux WiredTiger prototype; full Windows build/integration pending until the actual workflow succeeds. This code is a development preview, not an audited encrypted database product.

## GitHub

The private repository is `MohammadAtikurRahman/BsonLite`, and the source/workflows have been published on `main`. GitHub Actions is executing the native Windows build. Windows SDK, DPAPI/ACL/Unicode helper and source-preview packaging checks have passed. The full engine and embedded artifact still require their successful native run. See `NEW_REPOSITORY_BN.md` for repository/build details.

Place this SDK project at the new repository root. A push to `main` starts `.github/workflows/native-windows.yml`; **Actions → Build native encrypted Windows SDK → Run workflow** also permits a manual run. It only uploads **BsonLite-native-Windows-x64-<commit>** after all tests pass. The artifact includes checksums and the source commit/run reference. If keeping the SDK in a subfolder of an existing repository, move the workflow to the repository-level `.github/workflows/` and adjust working-directory and artifact paths to that subfolder.

A new workflow may need the repository owner's Actions approval or the connected app's Workflows permission. That is a build-host authorization, not customer encryption setup. No release is published automatically.

## Developer Windows build

Use Windows x64, PowerShell 7, Python 3.12, Node.js 20+, Visual Studio Build Tools with v141, its matching ATL headers and Windows SDK 10.0.19041.0. Python 2.7.18 is downloaded privately as a verified build-only NuGet package. With `-InstallBuildTools`, the builder also installs the pinned Microsoft VC90 runtime on the build host after SHA-256 and Authenticode verification. That installer URL is taken from Microsoft's official [redistributable downloads](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/). No Python/compilers or VC90 installer are delivered in the customer SDK. The installer, compiler configuration and Windows crypto probe have run in CI; full engine validation remains pending.

```powershell
./native/build_windows.ps1 -InstallBuildTools
python scripts/enable_windows_utf8.py
npm ci
npm test
$env:BSONLITE_NATIVE_BINARY = "$PWD/assets/native-win32-x64/mongod.exe"
$env:BSONLITE_NATIVE_MANIFEST = "$PWD/assets/native-win32-x64/native-engine.json"
npm run test:native-integration
```

The workflow records successful Windows validation before `npm run build`. Do not fabricate the validation flag. The static library is built from pinned libsodium source with the same compiler/CRT as the engine. Windows SChannel handles TLS; no old OpenSSL DLL is added to the customer package. The build rejects unexpected VC/crypto DLL imports. Actual platform testing is still required.

After the compiled engine cache is saved/restored, `scripts/enable_windows_utf8.py` uses the Windows SDK manifest tool to set this engine process's `activeCodePage` to UTF-8. This covers narrow CRT paths in the old external sorter without changing the customer's system locale. It preserves existing execution-level/OS manifest settings, rechecks the real cipher self-test, rebinds the binary hash, resets Windows validation to pending, and adds the manifest/helper/notices to the corresponding-source archive. This packaging stage does not change the cached C/C++ compilation inputs. The customer profile requires Windows 10 version 1903 (build 18362) or later, Windows 11, or a compatible Windows Server release. Its actual Unicode spill test must pass before a final artifact is published.

The patcher refuses a repeat/ambiguous patch and expects exact MongoDB 4.0.28 / WiredTiger 3.1.1 sources. Use a fresh extracted tree when modifying the patch. It registers encryption before recovery, adds a native self-test entry point, wires temporary-file protection, forces the native cipher after user-specified table/index settings, and opens Windows SChannel PEM files through Unicode paths. The matching modified-engine source archive accompanies the CI artifact.

SCons requires the Windows file target `mongod.exe` and its Python 2 `win32api` dependency. The pinned pywin32 wheel and private DLL copies are builder-only dependencies. The workflow caches compiled native outputs by native-source hash before running SDK integration tests; changing JavaScript alone can reuse that build. Every customer artifact still requires a fresh successful SDK/integration run.

## Linux proof of concept

Linux has a working dynamic loader in this old engine. For developer tests only:

```sh
python native/build_linux.py --mongo-binary /absolute/path/to/mongod-4.0.28
export BSONLITE_NATIVE_BINARY=/absolute/path/to/mongod-4.0.28
export BSONLITE_NATIVE_MANIFEST="$PWD/native/build/linux-x64/native-engine.json"
npm run test:native-integration
```

The supplied binary must run on the host; Ubuntu 18.04 MongoDB 4.0.28 needs its matching private OpenSSL 1.1 runtime on modern Linux. This prototype is **not** a Windows binary, has **no MongoDB temporary-file hooks**, and reports `verified:false`. It does not pass the full-native capability gate.

## Crypto format and keys

See `SECURITY.md`. Use libsodium's XChaCha20-Poly1305 implementation, never a new cipher invented for this project. The AEAD block overhead is 48 bytes. Domain + public key-id binding is implemented; authenticated file-position binding and anti-rollback are not. This needs independent storage/cryptography review before production.

A raw 32-byte data key and 16-byte public id enter the engine through a single 56-byte stdin frame (`BSLKEY01` + id + key). Stdin closes after the frame; truncation/extra data is refused. The key slot uses sodium secure allocation/memory locking. No raw key argument/environment/file is used by the design. JavaScript memory and OS paging/crash dumps remain outside this guarantee.

## Primary references

- WiredTiger encryptor API: https://source.wiredtiger.com/3.1.0/encryption.html
- Exact upstream source: https://github.com/mongodb/mongo/tree/af1a9dc12adcfa83cc19571cb3faba26eeddac92
- XChaCha20-Poly1305: https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction
- DPAPI: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
- Windows UTF-8 process manifest: https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page

Read the original SSPL/MongoDB notices, libsodium ISC license and SDK dependency notices before distribution. The wrapper's MIT license does not relicense the combined MongoDB engine.
