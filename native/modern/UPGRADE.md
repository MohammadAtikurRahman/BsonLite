# Upgrade an existing encrypted BsonLite database

The current core uses engine 9.0.4 and driver 7.7.0. An existing encrypted 4.0.28 database must be copied logically into a new directory; the new engine must not open its old files directly.

Close applications using the old store. Keep the original directory, its protected vault and an encrypted backup. Perform the upgrade under the Windows account that can open the old store.

Install the previous SDK under a separate name:

```sh
npm install bsonlite-previous@npm:bsonlite-sdk@0.6.0-rc.3
```

Use a validated current single-file SDK, not a source preview:

```js
const previous = require('bsonlite-previous');
const modern = require('./BsonLite.cjs');

async function main() {
  await previous.backup({
    directory: './Database',
    file: './before-upgrade.bslbackup',
    password: process.env.BSONLITE_BACKUP_PASSWORD
  });
  const result = await modern.upgrade({
    sourceSDK: previous,
    sourceDirectory: './Database',
    directory: './Database9'
  });
  console.log(result);
}
main().catch(error => {
  console.error(error.code, error.message);
  process.exitCode = 1;
});
```

Set your own strong backup password in `BSONLITE_BACKUP_PASSWORD`. The destination must not already exist or overlap the source.

The upgrader preserves BSON through binary serialization, copies supported collection options, validators, indexes and views, and compares document counts and digests. Failed/interrupted destinations remain marked incomplete. The original records are retained. Non-simple collations require tested, explicit `allowCollationUpgrade: true` because ICU comparison rules can differ.

After verification, use the new SDK and destination:

```js
await BsonLite.connect({ directory: './Database9' });
```

Use `BsonLite.BSON` / `BsonLite.ObjectId` when constructing values for the upgraded application. BSON objects created by a different major library cannot be passed directly. The upgrader and Console bridge perform their own cross-version conversion.

Verify your application data and create a new encrypted backup. Keep the original database and backup until your application has been checked. Older non-native formats must first follow the previous SDK's documented migration path.

The profile requires Windows x64 build 20348+ and Node.js 20.19+. See [build and validation](README.md) and [test evidence](../../TEST_RESULTS.md).
