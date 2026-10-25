# BsonLite

A single-file, MongoDB-based Node.js SDK for offline Windows applications. The customer artifact includes the driver, custom engine, certificate code and notices in **BsonLite.cjs**. MongoDB 4.0.28 runs behind the API; customers do not install MongoDB, compilers, Python, libsodium, EFS or BitLocker.

This is a release candidate with a defined Windows x64 profile, not an independently audited database product. Every downloadable native artifact is produced only after the Windows workflow passes its source and final-bundle checks. Its `validation.json` identifies the exact commit and run. A Git checkout and `build:preview` contain source work rather than a customer engine.

## Experimental modern engine

The experimental build path in `main` and `upgrade/mongodb-9.0` ports the encrypted engine to pinned MongoDB
Community 9.0.4 / WiredTiger 12 and Node.js driver 7.7.0. It adds a logical
`BsonLite.upgrade(...)` path from the previous encrypted SDK, preserving BSON,
indexes, validators and views in a new directory. The original store stays in
place. Node.js 20.19+ and Windows x64 build 20348+ are the modern build profile.

Experimental SDK **0.7.0-alpha.0** passed its complete Windows engine and
single-file consumer gates on **2026-10-25** at commit
`5137fbc92749f20679445657d504718446db4eab`:
[successful run](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708).
The run covers native encryption, backup/restore, 141-record migration with
typed BSON, indexes and views, forced-engine-crash recovery, TLS/authentication,
the existing CLI and isolated concurrent single-file consumers.

- [Standalone SDK, matching engine source and test evidence](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708/artifacts/12594725727): use `dist-modern/BsonLite.cjs`.
- [Prepared npm prerelease tarball](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708/artifacts/12594269894): `bsonlite-sdk-0.7.0-alpha.0.tgz`, prepared for the `next` tag.
- [বাংলা usage and migration guide](native/modern/UPGRADE_BN.md) and [build instructions](native/modern/README.md).

The npm tarball was packed, installed and checksum/import verified on Windows;
it has not been published to the registry. `npm run build` selects the 0.6
legacy profile; `npm run build:modern` selects the validated experimental path.
Existing 4.0 stores need a logical upgrade into a new directory. Clean desktop
and independent security validation remain separate from these CI results.

## Use

Copy the validated `BsonLite.cjs` into your Node.js project:

```js
const BsonLite = require('./BsonLite.cjs');

async function main() {
  await BsonLite.connect();
  // Start your server or desktop application here.
}
main().catch(error => {
  console.error(error.code, error.message);
  process.exitCode = 1;
});
```

Other files use the same SDK after connection:

```js
const BsonLite = require('./BsonLite.cjs');
module.exports.addUser = user => BsonLite.collection('users').insertOne(user);
```

Startup prints connection status and the database port. It does not insert or print documents. `BsonLite.status()` exposes connection details; `await BsonLite.disconnect()` stops it. A name is optional (`connect('myapp')`); an existing store's name is inferred when omitted. CommonJS `require` and ES-module default `import` are supported.

`BsonLite.BSON` supplies `Long`, `Decimal128`, `Binary`, `Int32`, `Double`, `BSONRegExp`, serializers and other BSON types without a separate npm install. `BsonLite.ObjectId` remains available directly.

Data stays in `./Database`. The SDK extracts its trusted engine into private OS application data; the protected credential/data-key vault and temporary TLS sessions also stay there. The operating system needs an executable file to run the engine. These runtime files are outside the application project.

## Encryption and connection

The custom WiredTiger 3.1.1 encryptor uses pinned libsodium 1.0.22 / XChaCha20-Poly1305 with an independent random key per database. The full engine also protects MongoDB temporary spill files and forces encryption on collection/index creation. Process diagnostics use separately derived AES-256-GCM keys. This is live-file encryption, independent of EFS or BitLocker.

Windows DPAPI CurrentUser protects the key vault. The SDK configures loopback-only binding, a random port, mutual TLS, SCRAM-SHA-256, private file permissions and a rotating readWrite application account. Raw data keys are passed through a bounded stdin frame, never an engine argument, environment variable or plaintext key file.

## Compatibility: 0.6 legacy profile

| Area | Profile |
| --- | --- |
| OS / CPU | Windows 10 version 1903+ or Windows 11, x64; compatible Windows Server releases |
| Runtime | Node.js 20+ or a compatible packaged runtime; CI uses Node.js 24 on Windows Server 2022 |
| Filesystem | A private writable location with Windows access controls, normally NTFS |
| Queries | MongoDB 4.0.28 CRUD, BSON, indexes and aggregation supported by that server version |
| Process | One authenticated standalone MongoDB process per store, bound to `127.0.0.1` |
| Server-side JavaScript | Disabled; `$where` and JavaScript-based `mapReduce` are unavailable |
| Transactions / change streams | Replica-set features are outside this standalone profile |
| Packaged desktop apps | The application must supply Node/runtime and a writable data location; actual Electron/installer tests remain necessary |

The CJS is an SDK, not a standalone EXE. Clean Windows Home/Pro, packaged Electron, power-loss/disk-full behavior and independent security review remain outside the automated CI evidence.

## Existing data and recovery

Native encryption is the default for new databases. Preserve existing `Database` folders and their matching vaults. Earlier stores are not encrypted by changing metadata or flags. For supported non-native BsonLite 0.4/0.5 stores, use `BsonLite.migrate({sourceDirectory, directory})` into a new directory. It preserves BSON types, collection options, supported indexes and views through TLS, keeps the original records, and marks interrupted destinations incomplete. Older legacy stores require encrypted export/restore first. See `START_HERE_BN.md`.

Stopped-store `backup({file,password})` and `restore({file,password,directory})` preserve the native key and cipher metadata in an authenticated encrypted archive. Restore wraps the key for the destination account. Physical backups require the same OS, architecture and engine. Copying only `Database` to another account/PC does not copy its protected key.

`BsonLite.recover({directory})` handles provably stale locks after all using apps have closed. It checks project, private-store and engine ownership and preserves records/vaults. It refuses living processes or ambiguous ownership; it does not kill processes or reset data.

Explicit `storageEncryption:'auto'|'required'|'none'` is retained for earlier-format administration/migration. Native stores reject plaintext downgrades. `native-prototype` is a limited Linux developer mode and never reports full verification.

## Source and build

Source: [MohammadAtikurRahman/BsonLite](https://github.com/MohammadAtikurRahman/BsonLite), branch `main`.

A push to `main` runs **Build native encrypted Windows SDK**. Only a successful run uploads **BsonLite-native-Windows-x64-<commit>**, including `dist/BsonLite.cjs`, starter files, hashes, validation provenance, notices and matching modified-engine source. The workflow does not automatically publish a GitHub Release. See `native/README.md`, `DEPLOY_WINDOWS.md` and `TEST_RESULTS.md`.

For source development:

```sh
npm ci
npm test
npm run build:preview
npm run test:packaging
```

`npm run build` requires the matching custom engine and successful Windows integration validation. The source preview intentionally has no embedded engine.

Read `SECURITY.md` and `licenses/SOURCE_AND_NOTICES.md` before distribution. MongoDB 4.0.28 is end-of-life; this encryption layer does not supply upstream server maintenance. The SDK does not promise anti-rollback protection or confidentiality against compromised runtimes, same-account malware, administrators, pagefiles, hibernation or OS crash dumps. Plan encrypted backups before distributing an offline product.

## Automatic BsonLite Console connections

After updating the SDK, keep your existing `BsonLite.connect(...)` code. BsonLite Console 0.2.0 discovers the running local database, fills its URL, and opens it when you click Connect. Multiple apps appear in a dropdown. No separate helper package or project-folder selection is required.

The optional adapter starts only after database connection and uses a private current-account registry and a token-protected HTTP endpoint on 127.0.0.1. The native encrypted engine and its mutual TLS connection are unchanged. Stop the SDK normally to remove the session. Set `console: false` in initial connection options or `BSONLITE_CONSOLE=0` to opt out. A running shared connection rejects conflicting Console options until it is stopped.

The adapter source is bundled in `src/console-addon.cjs`; its Acorn dependency license is included. The standalone SDK combines the native distribution with this adapter. npm distribution rc.3 loads its preserved core via its adapter entry point. The packed legacy SDK's Windows Console/CLI check passed in [run 40179501476](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/actions/runs/40179501476). The updated adapter preserves concurrent `start()` calls and rejects conflicting connection settings. The same core commit passed both [the complete legacy Windows suite](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496707) and [the modern engine/CLI gates](https://github.com/MohammadAtikurRahman/BsonLite/actions/runs/40181496708). The CLI compatibility fixture pins the real Console 0.2.0 client files and verifies their hashes before testing. See `CONSOLE_BN.md` and [test evidence](TEST_RESULTS.md).
