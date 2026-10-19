# BsonLite 0.6.0-preview.2

Native-encryption development preview for an offline MongoDB-based Node.js SDK.

**This source preview does not contain a rebuilt Windows encrypted engine. It is not a ready-to-use encrypted Windows release.** The Windows build workflow must compile the custom engine and pass its integration tests before a customer artifact is produced. The earlier stock executable is not accepted as an encrypted engine.

The implementation keeps MongoDB **4.0.28** and driver **6.16.0**. It adds a WiredTiger 3.1.1 encryptor using pinned **libsodium 1.0.22 / XChaCha20-Poly1305**. Crypto is integrated at the storage layer so queries can run on ordinary values in memory. A full engine build also patches MongoDB temporary-file encryption hooks and forces encryption on collection/index creation. Process diagnostics use independently derived AES-256-GCM keys.

## Status

- Actual Linux MongoDB CRUD, BSON values, text/unique indexes, aggregate queries, encrypted WiredTiger data/journals, reopen, wrong-key refusal, encrypted backup/restore and migration were exercised.
- The Linux dynamic extension is deliberately labeled `native-prototype`: MongoDB temporary-file hooks and table-override enforcement require the rebuilt engine. It never reports full encryption verification.
- Native Windows compilation, DPAPI/ACL behavior, actual spill-file encryption and the final embedded consumer artifact must pass the Windows workflow. See `TEST_RESULTS.md` for exact scope.
- The included `dist/BsonLite.cjs` is a **source preview bundle**, with no embedded engine. Import works without npm packages; opening without a developer engine fails closed. Do not distribute it to customers as a ready database.

## Final customer API (after a successful Windows build)

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

Other application files use `BsonLite.collection('users')` after startup. Data stays in `./Database`; engine, credential/data-key vault and TLS sessions use private OS application data. A final CJS contains the driver, certificate code, static crypto engine and notices. Node.js 20+ or a compatible packaged runtime is required. It is an SDK, not a standalone customer EXE.

## Compatibility

| Area | Supported profile |
| --- | --- |
| Customer runtime | Windows 10 version 1903+ / Windows 11 x64 with Node.js 20+ or an app that packages a compatible runtime |
| Query API | MongoDB 4.0.28 CRUD, BSON values, indexes and aggregation operators supported by that server version |
| Deployment | One standalone, authenticated MongoDB process bound to `127.0.0.1` |
| Server-side JavaScript | Disabled; `$where` and JavaScript-based `mapReduce` are unavailable |
| Multi-document transactions and change streams | Require replica-set configuration, which this standalone profile does not provide |
| Filesystem | A private writable location with Windows access controls, normally NTFS |
| Data recovery on another account/PC | Restore a matching encrypted backup with its password; the data key is protected separately in the account vault |

## Build

This project has its own private GitHub repository, [MohammadAtikurRahman/BsonLite](https://github.com/MohammadAtikurRahman/BsonLite), on `main`. A successful Windows workflow is still required before a customer engine is available. See [NEW_REPOSITORY_BN.md](NEW_REPOSITORY_BN.md) for repository and build details.

Read `native/README.md`. A push to `main` automatically starts the GitHub Windows workflow. It builds pinned source, runs the native and compatibility tests, and only then packages the single-file SDK, checksums, validation provenance and matching modified-engine source. Customer PCs do not need compilers, Python or a libsodium installation.

```sh
npm ci
npm test
npm run build:preview
npm run test:packaging
```

`npm run build` intentionally refuses the stock engine or an engine lacking successful Windows native validation. `npm run build:preview` produces reviewable JS without an engine.

## Existing databases and backups

Native encryption is the default for new databases. Existing 0.4/0.5 data is not relabeled or encrypted in place. With a validated engine, call `BsonLite.migrate({sourceDirectory, directory})` into a new directory. Documents, BSON types, collection options, supported indexes and views are copied through TLS; no plaintext export file is created. The original user records remain available. Failed/interrupted destinations stay marked incomplete. Special system collections are refused rather than silently omitted.

Explicit `storageEncryption:'auto'|'required'|'none'` remains for earlier-format administration/migration. Native stores refuse a plaintext downgrade. `native-prototype` is a Linux developer mode, not a customer profile.

Stopped-store `backup({file,password})` and `restore({file,password,directory})` preserve the native cipher, data key and key id inside an authenticated encrypted archive. Restore wraps the key for the destination account. Physical backups remain restricted to the same OS/architecture/engine. A copied folder alone is not a portable recovery method.

## Security and distribution

Read `SECURITY.md` and `licenses/SOURCE_AND_NOTICES.md`. Key recovery must be planned before selling an offline product. This preview has no independent security audit, anti-rollback guarantee, or proof that plaintext never reaches OS pagefiles/crash dumps. MongoDB and its license are explicitly disclosed.
