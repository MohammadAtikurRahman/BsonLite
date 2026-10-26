# BsonLite

**A portable MongoDB-based local database for Node.js and Windows, with native encrypted storage and automatic engine setup.**

## Products and downloads

| Name | What it is |
| --- | --- |
| **BsonLite** | The database, downloaded as one `BsonLite.cjs` file. |
| **`bsonlite-sdk`** | The npm package for BsonLite. |
| **BsonLite Console** | The desktop GUI, integrated query console and optional terminal CLI. |

[Download BsonLite](https://bsonlite.com/download.html) · [BsonLite Console](https://bsonlite.com/console.html) · [Documentation](https://bsonlite.com/docs/) · [Support development](https://buymeacoffee.com/bsonlite)

Install the modern npm release with `npm install bsonlite-sdk@next`. Registry tags can move; check `npm view bsonlite-sdk dist-tags --json` before an upgrade. To retain the earlier engine line, explicitly pin `bsonlite-sdk@0.6.0-rc.3`. Old data files need the documented logical upgrade before switching engine generations.

The default core is **BsonLite 0.7.0-alpha.0, engine 9.0.4 and driver 7.7.0**. Ordinary `npm run build` and `npm run build:preview` select this profile and write `dist/BsonLite.cjs`.

## Requirements

- Windows x64 build 20348 or later (Windows Server 2022 / Windows 11 profile).
- Node.js 20.19 or later; CI uses Node.js 24.
- A private, writable directory, normally on NTFS.

The modern engine is an experimental prerelease. See [test evidence](TEST_RESULTS.md) for the exact tested commits, artifacts and remaining validation limits.

## Use a validated BsonLite

[Download BsonLite.cjs](https://bsonlite.com/download.php?file=bsonlite) directly from the website. Matching source, notices and validation records are linked on the [download page](https://bsonlite.com/download.html#source). Maintainers can also inspect the [Windows engine workflow](https://github.com/MohammadAtikurRahman/BsonLite/actions/workflows/modern-engine.yml). Copy its `BsonLite.cjs` into your application:

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

A running app appears in BsonLite Console 0.3.0 automatically. The GUI is a separate application. See the [Console guide](CONSOLE.md) and [software page](https://bsonlite.com/console.html).

## Develop from source

### Build the standalone file after pulling

This checkout temporarily tracks the validated native build inputs so a maintainer can rebuild the standalone BsonLite file without downloading extra engine files or compiling C++:

```sh
git pull --ff-only origin main
npm ci
npm run build
```

Keep these files in the core project:

- `assets/modern-win32-x64/native-engine.json` and `build-assets.json`.
- All parts under `assets/modern-win32-x64/packed/` and `native/build/modern/packed/`.
- `licenses/modern/` and the snapshot validation records under `assets/modern-win32-x64/`.

The parts contain the actual tested 9.0.4 encrypted engine and its matching modified source archive. `npm run build` verifies their SHA-256 hashes, reconstructs `assets/modern-win32-x64/mongod.exe` and `native/build/modern/BsonLite-modern-engine-source.tar.gz` when needed, and then runs the normal native engine checks before bundling. It never marks an untested engine as validated. The part files are binary Git files; no Git LFS or separate download is required. They are split to fit GitHub's [regular file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).

The result is **`dist/BsonLite.cjs` with `Mode: native-encrypted`**. Publish that CJS as the direct website download. It already contains the engine and required JavaScript dependencies; customers do not need the core build inputs, a ZIP installer, npm installation or a separate database installation. Node.js and the supported Windows version are still required. Keep the matching engine source and notices available through the documentation/source links. The Console/CLI application remains a separate download, and npm users can choose `bsonlite-sdk`.

The relevant `.gitignore` rules are temporarily removed at the maintainer's request. Keep the tracked parts and the restored engine/source files locally; ignore rules will only be restored after the maintainer confirms the transfer. Adding an ignore rule alone does not untrack an already committed file.

### Check a source preview

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

A preview contains the JavaScript layer of BsonLite and driver, without an executable database engine. It is for source and packaging checks. A full `npm run build` needs the matching validated Windows engine, native manifest and source archive. The [Windows workflow](.github/workflows/modern-engine.yml) builds these, runs real native/migration/CLI tests and tests the actual default-build CJS before uploading downloads.

A preview replaces the same `dist/BsonLite.cjs` path. Run `npm run build` as the final build step before uploading the standalone file, and confirm `Mode: native-encrypted`.

The explicit `build:modern` and `build:modern:preview` aliases retain `dist-modern/` for existing tooling. The separate `build:legacy` and `build:legacy:preview` commands select the old 4.0.28/driver 6.16.0 compatibility profile and write `dist-legacy/`. Neither legacy command is the default.

## Existing databases

Use [the logical upgrade guide](native/modern/UPGRADE.md) for an existing encrypted 4.0.28 store. It copies records into a new directory, converts BSON across driver majors, recreates supported indexes/validators/views, verifies counts/digests and preserves the original records. The default 9.0 core refuses to open old 4.0 files directly.

Keep an encrypted backup and the original protected vault. A physical backup requires its matching engine; copying metadata or changing a version is not migration. Non-simple collations need explicit review across ICU versions.

## Encryption and supported operations

BsonLite is independently developed using a custom MongoDB Community engine. It supports that standalone server's document queries, BSON, indexes and aggregation, including window aggregation in the modern profile. Server-side JavaScript, replica-set transactions, change streams and Atlas-only services are outside this profile.

The custom WiredTiger 12 encryptor uses libsodium 1.0.22 / XChaCha20-Poly1305 for data and journals, and protects temporary spill data. Process logs are encrypted. Windows DPAPI CurrentUser protects each store's key vault. BsonLite uses loopback-only networking, mutual TLS, SCRAM-SHA-256, private file permissions and rotating application credentials. Raw data keys travel over a bounded stdin frame.

BsonLite requires a Node.js runtime. Clean Windows desktop/GUI testing, target-machine performance measurements and independent storage/cryptography review remain separate work. See [SECURITY.md](SECURITY.md).

## Documentation and source

- [Quick start](START_HERE.md)
- [Console and CLI](CONSOLE.md)
- [Native build and validation](native/modern/README.md)
- [333-case query compatibility audit](QUERY_COMPATIBILITY.md)
- [Database upgrade](native/modern/UPGRADE.md)
- [npm preparation and publishing](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/main/MODERN_ENGINE.md)
- [Contributing](CONTRIBUTING.md)

The JavaScript wrapper is MIT licensed. The modified engine remains SSPL-1.0. Matching modified engine source and component notices must accompany distribution; the wrapper does not relicense the engine.
