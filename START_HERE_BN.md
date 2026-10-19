# BsonLite 0.6 native encryption preview — শুরু করার আগে

**এটি নতুন encryption version-এর code ও build প্রস্তুতি। Windows-এর জন্য তৈরি ও পরীক্ষিত encrypted engine এখনো এই source preview-তে নেই। বর্তমান `dist/BsonLite.cjs` customer-কে দিয়ে সরাসরি database চালানো যাবে না।**

ভেতরে আছে: WiredTiger encryption module, প্রতিটি database-এর আলাদা random key, protected vault, encrypted logs, native backup/restore, পুরোনো data migration এবং Windows build workflow। MongoDB version 4.0.28-ই রাখা হয়েছে।

## তোমার এখন যা করতে হবে

আলাদা private GitHub repository তৈরি হয়েছে: [MohammadAtikurRahman/BsonLite](https://github.com/MohammadAtikurRahman/BsonLite)। Source আপলোড হয়েছে এবং Windows engine build চলছে। বিস্তারিত আছে [NEW_REPOSITORY_BN.md](NEW_REPOSITORY_BN.md)-এ।

Build workflow এই project-এ দেওয়া আছে। নতুন repo-র `main` branch-এ code push হলেই Windows build শুরু হবে। Manual run-ও করা যাবে **Actions → Build native encrypted Windows SDK → Run workflow** থেকে। Build ও সব tests সফল হলে **BsonLite-native-Windows-x64-…** artifact-এর `dist/BsonLite.cjs` হবে engine-সহ single file। Source preview-কে final file মনে করবে না।

এই build কাজ developer/CI-এর। তোমার customer-কে compiler, Python, libsodium বা encryption command চালাতে হবে না। Customer-এর desktop app-এ Node/runtime packaging তোমাকে অন্তর্ভুক্ত করতে হবে; শুধু CJS নিজে standalone EXE নয়।

## Final build পাওয়ার পরে ব্যবহার

```js
const BsonLite = require('./BsonLite.cjs');
async function main() {
  await BsonLite.connect();
  // এখানে তোমার server/app চালু করো।
}
main().catch(error => {
  console.error(error.code, error.message);
  process.exitCode = 1;
});
```

অন্য file থেকে:

```js
const BsonLite = require('./BsonLite.cjs');
module.exports.addUser = user => BsonLite.collection('users').insertOne(user);
```

শুরুতে port/TLS/credentials/key নিজে তৈরি হবে। Record নিজে থেকে insert বা print হবে না। Data থাকবে project-এর `Database` folder-এ। Engine/vault থাকবে private OS application data-তে।

## আগের database আছে?

**পুরোনো `Database` delete বা metadata বদলাবে না।** Validated encrypted engine পাওয়ার পর:

```js
await BsonLite.migrate({
  sourceDirectory: './Database',
  directory: './DatabaseEncrypted'
});
```

দুই database-ই বন্ধ রেখে migration শুরু করবে। সফল হওয়ার পর তোমার app-এ `connect({directory:'./DatabaseEncrypted'})` ব্যবহার করবে। Migration-এর সময় মূল data রেখে দেওয়া হয়। অর্থাৎ পুরোনো copy-তে আগের encryption অবস্থাই থাকবে; migration তাকে নিরাপদে মুছে দেয় না।

## Status বুঝবে কীভাবে?

- Final rebuilt engine: `Native encryption verified` — startup self-test, requested engine configuration ও encrypted block check পাস করেছে।
- Linux prototype: temporary files সুরক্ষিত নয় বলে পরিষ্কার warning থাকবে এবং `verified:false` থাকবে।
- `BSONLITE_NATIVE_BUILD_REQUIRED` / `BSONLITE_ENGINE_NOT_EMBEDDED`: final encrypted engine তৈরি/অন্তর্ভুক্ত হয়নি। Settings বদলে এটিকে encrypted বলা যাবে না।

## Backup জরুরি

Database বন্ধ করার পরে:

```js
await BsonLite.backup({
  directory: './DatabaseEncrypted',
  file: './backup.bslbackup',
  password: process.env.MY_BACKUP_PASSWORD
});
```

অন্তত ১৬ অক্ষরের শক্তিশালী password ব্যবহার করবে এবং আলাদাভাবে নিরাপদে রাখবে। Windows reinstall বা অন্য PC-তে নেওয়ার জন্য matching encrypted backup দরকার। Password/key দুটোই হারালে data উদ্ধার করার কোনো master bypass key নেই।

এই preview-কে এখনই production-ready বা bulletproof বলে বিক্রি করবে না। Windows build, clean-PC পরীক্ষা এবং security review বাকি আছে।
