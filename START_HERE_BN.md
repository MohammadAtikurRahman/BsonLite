# BsonLite 0.6.0-rc.1 — ব্যবহার শুরু

এই নির্দেশনা সফল Windows build-এর **engine-সহ `BsonLite.cjs`**-এর জন্য। Git checkout বা `build:preview` bundle-এ engine থাকে না। Downloadable native artifact শুধু সব Windows checks পাস করার পর তৈরি হয়; matching commit/run থাকে `validation.json`-এ।

## প্রথমে চালাও

Windows x64 ও Node.js 20+ প্রয়োজন; CI-তে Node.js 24 ব্যবহার করা হয়। নিজের account থেকে লেখা যায় এমন NTFS folder ব্যবহার করো। EFS, BitLocker, MongoDB installation, Python, compiler বা আলাদা npm package লাগবে না। CJS নিজে standalone EXE নয়; desktop app বানালে app-এর সঙ্গে compatible Node/runtime দিতে হবে।

যে folder-এ `BsonLite.cjs` ও দেওয়া `index.js` আছে, সেখানে terminal খুলে চালাও:

```powershell
node index.js
```

দুটি status line দেখাবে: database connected এবং app server running। Browser-এ `http://127.0.0.1:3000/health` খুললে connection status ও database port দেখা যাবে। Record নিজে থেকে insert বা print হবে না। বন্ধ করতে `Ctrl+C`।

## নিজের project-এ

Project-এ `BsonLite.cjs` রেখে entry file থেকে:

```js
const BsonLite = require('./BsonLite.cjs');

async function main() {
  await BsonLite.connect();
  // এখানে তোমার server বা desktop app চালু করো।
}
main().catch(error => {
  console.error(error.code, error.message);
  process.exitCode = 1;
});
```

অন্য file থেকে, connection চালু হওয়ার পরে:

```js
const BsonLite = require('./BsonLite.cjs');
module.exports.addUser = user => BsonLite.collection('users').insertOne(user);
```

দেওয়া `users.js`-এ input validation-সহ example আছে। ESM project হলে `import BsonLite from './BsonLite.cjs'` ব্যবহার করবে।

Database name না দিলেও চলবে। চাইলে `await BsonLite.connect('myapp')`। Port, TLS certificates, credentials ও encryption key SDK তৈরি করে। `BsonLite.status().port` দিয়ে database port পাওয়া যায়। Advanced BSON types আছে `BsonLite.BSON`-এ; যেমন `BsonLite.BSON.Decimal128.fromString('12.50')`।

## File কোথায় থাকবে

- `Database/`: project-এর data; default-এ native encryption চালু।
- Private Windows application data: extracted engine, DPAPI-protected credential/data-key vault এবং temporary TLS files। এগুলো project folder-এ তৈরি হয় না।

Windows-এ executable চালাতে engine-কে একটি file হিসেবে extract করতেই হয়। MongoDB 4.0.28 ভেতরে ব্যবহৃত হচ্ছে; runtime files গোপন রাখার security দাবি নেই। Database folder অন্য PC/account-এ copy করলেই protected key সঙ্গে যায় না। Portable recovery-এর জন্য encrypted backup রাখো।

## আগে থেকে Database থাকলে

**পুরোনো `Database`, metadata বা matching vault delete করবে না।** পুরোনো non-native data চালু করতে গেলে `BSONLITE_NATIVE_MIGRATION_REQUIRED` আসতে পারে। Supported 0.4/0.5 store বন্ধ রেখে নতুন directory-তে migrate করো:

```js
await BsonLite.migrate({
  sourceDirectory: './Database',
  directory: './DatabaseEncrypted'
});
```

সফল হলে app-এ `await BsonLite.connect({ directory: './DatabaseEncrypted' })` ব্যবহার করো। Migration মূল data রেখে দেয়; মূল copy আগের encryption অবস্থাতেই থাকে। আরও পুরোনো legacy format হলে আগে encrypted `backup`/`restore` দিয়ে supported non-native copy তৈরি করতে হবে; metadata হাতে বদলে নতুন format লিখবে না।

## Backup

আগে database বন্ধ করো। Password অন্তত ১৬ অক্ষরের শক্তিশালী, আলাদাভাবে নিরাপদে রাখা মান ব্যবহার করো:

```js
await BsonLite.disconnect();
await BsonLite.backup({
  directory: './Database',
  file: './backup.bslbackup',
  password: process.env.MY_BACKUP_PASSWORD
});
```

নতুন PC/account-এ, একই OS/architecture/engine profile ব্যবহার করে:

```js
await BsonLite.restore({
  directory: './RestoredDatabase',
  file: './backup.bslbackup',
  password: process.env.MY_BACKUP_PASSWORD
});
await BsonLite.connect({ directory: './RestoredDatabase' });
```

Backup data key-ও encrypted অবস্থায় সংরক্ষণ করে এবং restore নতুন account-এর vault তৈরি করে। সব matching keys/backups/password হারালে vendor/master bypass key দিয়ে উদ্ধার করার ব্যবস্থা নেই।

## Lock বা startup error

অন্য app database ব্যবহার করলে সেটি আগে বন্ধ করো। Crash-এর পরে stale-lock error থাকলে সব using apps বন্ধ রেখে অন্তত ৬০ সেকেন্ড পরে app থেকে `BsonLite.recover({ directory: './Database' })` ব্যবহার করা যায়। এটি live process বা অস্পষ্ট ownership পেলে থামে; data reset বা process kill করে না। `Database` delete করে error সমাধান করবে না।

## Security-এর সীমা

এটি release candidate। Windows CI evidence artifact-এর সঙ্গে থাকে; clean Windows Home/Pro, নিজের packaged Electron/app, power-loss/disk-full এবং independent cryptography/storage audit এখনও আলাদা কাজ। MongoDB 4.0.28 end-of-life; custom encryption upstream security maintenance যোগ করে না।

Disk files encrypted হলেও running app-এর memory, same-account malware/admin compromise, pagefile/hibernation, OS crash dumps ও rollback-এর বিরুদ্ধে সম্পূর্ণ সুরক্ষার দাবি নেই। বিস্তারিত `SECURITY.md`-এ। Product-কে “bulletproof” বলে বিক্রি করবে না। Distribution-এর জন্য দেওয়া licenses ও matching modified-engine source সংরক্ষণ করো।
