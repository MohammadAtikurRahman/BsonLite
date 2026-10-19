# Windows build and customer deployment

This preview is source work, not a completed encrypted Windows release.

The GitHub workflow `Build native encrypted Windows SDK` uses Windows Server 2022 to build a custom MongoDB 4.0.28 engine with a statically linked libsodium 1.0.22 encryptor, v141 compiler toolset, static CRT and native Windows SChannel TLS. Its actual success must be checked; configuration files are not evidence that a build has run.

Developer-only downloads are pinned in `native/deps.lock.json`. Python 2.7 is confined to the legacy engine build host; Python 3.12 orchestrates verified downloads and source patching. Customer machines do not need these build tools. With `-InstallBuildTools`, the runner installs missing v141, matching v141 ATL and Windows SDK components, plus the pinned Microsoft-signed VC90 runtime for its Python 2 interpreter. Neither installer nor Python is included in the customer artifact. This Windows path still needs a successful full engine run.

The full workflow compiles crypto and engine, runs unit tests, tests real native data/journals/temp spills and migration, bundles only after successful validation, tests the final embedded consumer, and uploads the SDK with licenses and matching modified-engine source. The workflow is experimental until an actual run succeeds. Do not manually set the `windowsIntegration` manifest field to bypass tests.

The source preview CJS has no engine. `npm run build:preview` is for review/testing with explicit developer engine paths. `npm run build` rejects an absent/stock/unvalidated encrypted engine.

For final customer use, include `BsonLite.cjs` in the app's backend/main process. Provide Node.js 20+ through a supported runtime, or package a compatible Electron app. Existing Electron fuses, ASAR placement, signing and spawning rules need an actual packaged-app test. This project does not supply an installer or standalone EXE.

Test an account without administrator privileges on fresh Windows Home and Pro installations. Verify that first launch has no compiler/crypto downloads, no EFS/BitLocker dependency, no unexpected DLL prerequisite, no plaintext database or process log, working restart and matching encrypted backup restore. CI's preinstalled software is not a substitute for a clean-PC check.

Source and workflows are published in the private `MohammadAtikurRahman/BsonLite` repository. Windows SDK/security/Unicode helper and source-preview packaging checks have passed; native engine compilation is in progress. Pushing `main` starts the full workflow automatically; it publishes a downloadable Actions artifact only after every test succeeds. It does not publish a GitHub Release.

Use a writable ACL-capable NTFS location for the database and private vault. Native encryption does not make a read-only application install directory writable or add filesystem permissions to FAT/exFAT. Windows x64 is the current native build target.
