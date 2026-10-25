# Windows distribution

The current core is SDK 0.7.0-alpha.0 with engine 9.0.4 and driver 7.7.0. Its profile requires Windows x64 build 20348+ and Node.js 20.19+.

Use the artifact from a successful [modern Windows workflow](.github/workflows/modern-engine.yml). It contains the standalone `dist/BsonLite.cjs`, matching engine/source, notices and validation evidence. The `dist-modern` compatibility copy supports the npm preparation tooling.

The workflow builds the pinned Community source with Visual Studio 2022/v143, static libsodium and CRT, Windows SChannel and a verified UTF-8 process manifest. Real source/native, migration/CLI and final embedded tests must pass before a customer artifact is uploaded. It exercises the ordinary default `npm run build`, not only a named modern build.

For a full local SDK build, keep the temporarily tracked native input folders, run `npm ci` and `npm run build`. The build reconstructs and verifies the pinned engine and matching source archive from the Git parts automatically. See [required build files](README.md#build-the-standalone-file-after-pulling). Upload `dist/BsonLite.cjs` as the direct website SDK download; it contains the engine. Keep source/notices available separately. Console/CLI and npm are separate distribution options.

For local source checks, run `npm ci`, `npm test`, `npm run build:preview` and `npm run test:packaging`. A preview has no embedded database executable. To change or recompile the native engine itself, follow [the native build guide](native/modern/README.md) and repeat its real runtime validation.

Keep data in a private writable application location. The SDK manages its engine/vault in private OS application data. Do not place mutable data inside a read-only application installation directory. For an old database, perform [logical upgrade](native/modern/UPGRADE.md) into a new directory.

Run your own clean Windows GUI/installer and target-machine checks before production distribution. Retain encrypted backups, matching SSPL engine source and component licenses. See [test evidence](TEST_RESULTS.md) and [security model](SECURITY.md).
