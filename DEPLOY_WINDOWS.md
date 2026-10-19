# Windows build and deployment

BsonLite 0.6.0-rc.1 is a Windows x64 SDK release candidate. A customer artifact is uploaded only after the complete native Windows workflow succeeds. The artifact's `validation.json` identifies its matching commit/run; a source-preview CJS has no embedded engine.

The pinned MongoDB 4.0.28 engine has compiled and linked on Windows Server 2022 with v141, Windows SDK 10.0.19041.0, static CRT, static libsodium 1.0.22 and native Windows SChannel TLS. The builder checks external DLL imports, rejects `MiniDumpWriteDump`, runs the actual cipher self-test and packages the matching modified-engine source. Compiled outputs are cached by native-source hash. Full runtime checks remain mandatory for every delivered SDK build.

`enable_windows_utf8.py` adds an engine-process UTF-8 manifest with the Windows SDK manifest tool, preserves execution-level/OS settings, rechecks the actual self-test, rebinds the binary hash and resets Windows integration to pending. The pinned engine uses a documented exit-code self-test protocol because MongoDB's fast termination bypasses stdout flushing. Source and final-bundle tests exercise real encrypted data/journals, actual aggregation spills, configuration overrides, migration, restore, isolated consumers and concurrent extraction before an artifact can be uploaded.

Developer-only downloads are pinned in `native/deps.lock.json`. Python 2.7 is confined to the legacy build host. The builder verifies the Microsoft-signed VC90 installer and installs v141/ATL/SDK components when needed. None of these tools/installers is required or included in the customer CJS. See `native/README.md`.

For customer use, place the validated `BsonLite.cjs` in the Node application's backend/main process. The file includes the driver and native engine; no separate npm/MongoDB/crypto installation or EFS/BitLocker setup is required. It needs Node.js 20+ or a compatible packaged runtime. CI uses Node.js 24. The CJS is not a standalone EXE or installer.

The engine requires Windows 10 version 1903 (build 18362) or later, Windows 11, or a compatible Windows Server release, x64. No system-locale command or reboot is requested. Engine/vault/TLS state uses private OS application data; the default `Database` stays in the working project. Use a private writable ACL-capable NTFS location. Installed applications under a read-only Program Files/ASAR directory must choose a writable data location explicitly.

Before customer distribution, test a normal non-admin account on clean Windows Home and Pro and test the actual packaged desktop application. Verify first launch, restart, Unicode paths, offline operation and matching encrypted backup restore. CI's installed software does not prove a clean-PC deployment. Electron fuses, ASAR placement, process spawning and application signing require a packaged-app test. No such result or independent security audit is claimed by this repository.

Preserve notices, matching modified-engine source and the original license conditions. The SDK wrapper's MIT license does not relicense MongoDB. The workflow publishes an Actions artifact, not an automatic GitHub Release.
