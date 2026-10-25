# BsonLite

A portable database SDK for Node.js and Windows applications, with native encrypted storage and automatic Console connections.

The default core is **SDK 0.7.0-alpha.0, engine 9.0.4 and driver 7.7.0**. Ordinary `npm run build` and `npm run build:preview` select this profile and write `dist/BsonLite.cjs`.

## Requirements

- Windows x64 build 20348 or later (Windows Server 2022 / Windows 11 profile).
- Node.js 20.19 or later; CI uses Node.js 24.
- A private, writable directory, normally on NTFS.

The modern engine is an experimental prerelease. See [test evidence](TEST_RESULTS.md) for the exact tested commits, artifacts and remaining validation limits.

## Use a validated SDK

Download the standalone SDK from a successful [Windows engine workflow](https://github.com/MohammadAtikurRahman/BsonLite/actions/workflows/modern-engine.yml), keeping its matching source, notices and validation record. Copy its `BsonLite.cjs` into your application:

```js
const BsonLite = require('./BsonLite.cjs');

async function main() {
  const db = await BsonLite.connect();
  await db.collection('users').insertOne({ name: 'Atik' });
  console.log(await db.collection('users').find({}).toArray());
  // Keep the connection open while your application is running.
}
main().catch(console.error);
```

Call `await BsonLite.disconnect()` when the application exits. Data defaults to `./Database`. CommonJS and ESM default imports are supported. Use `BsonLite.BSON` and `BsonLite.ObjectId` when creating typed query values.

A running app appears in BsonLite Console 0.2.0 automatically. The GUI is a separate application. See the [Console guide](CONSOLE.md) and [software page](https://bsonlite.com/console.html).

## Develop from source

```sh
npm ci
npm test
npm run build:preview
npm run test:packaging
```

Expected preview output:

```text
MongoDB 9.0.4 / win32/x64
Mode: source-preview (native engine not included)
```

A preview contains the JavaScript SDK and driver, without an executable database engine. It is for source and packaging checks. A full `npm run build` needs the matching validated Windows engine, native manifest and source archive. The [Windows workflow](.github/workflows/modern-engine.yml) builds these, runs real native/migration/CLI tests and tests the actual default-build CJS before uploading downloads.

The explicit `build:modern` and `build:modern:preview` aliases retain `dist-modern/` for existing tooling. The separate `build:legacy` and `build:legacy:preview` commands select the old 4.0.28/driver 6.16.0 compatibility profile and write `dist-legacy/`. Neither legacy command is the default.

## Existing databases

Use [the logical upgrade guide](native/modern/UPGRADE.md) for an existing encrypted 4.0.28 store. It copies records into a new directory, converts BSON across driver majors, recreates supported indexes/validators/views, verifies counts/digests and preserves the original records. The default 9.0 core refuses to open old 4.0 files directly.

Keep an encrypted backup and the original protected vault. A physical backup requires its matching engine; copying metadata or changing a version is not migration. Non-simple collations need explicit review across ICU versions.

## Encryption and supported operations

BsonLite is independently developed using a custom MongoDB Community engine. It supports that standalone server's document queries, BSON, indexes and aggregation, including window aggregation in the modern profile. Server-side JavaScript, replica-set transactions, change streams and Atlas-only services are outside this profile.

The custom WiredTiger 12 encryptor uses libsodium 1.0.22 / XChaCha20-Poly1305 for data and journals, and protects temporary spill data. Process logs are encrypted. Windows DPAPI CurrentUser protects each store's key vault. The SDK uses loopback-only networking, mutual TLS, SCRAM-SHA-256, private file permissions and rotating application credentials. Raw data keys travel over a bounded stdin frame.

The package is an SDK requiring a Node runtime. Clean Windows desktop/GUI testing, target-machine performance measurements and independent storage/cryptography review remain separate work. See [SECURITY.md](SECURITY.md).

## Documentation and source

- [Quick start](START_HERE.md)
- [Console and CLI](CONSOLE.md)
- [Native build and validation](native/modern/README.md)
- [Database upgrade](native/modern/UPGRADE.md)
- [npm preparation and publishing](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/main/MODERN_ENGINE.md)
- [Contributing](CONTRIBUTING.md)

The JavaScript wrapper is MIT licensed. The modified engine remains SSPL-1.0. Matching modified engine source and component notices must accompany distribution; the wrapper does not relicense the engine.
