# নতুন BsonLite engine ব্যবহার ও পুরোনো data নেওয়া

এই branch-এ MongoDB Community 9.0.4, WiredTiger 12 এবং Node.js driver 7.7.0
ব্যবহারের ব্যবস্থা আছে। এটি experimental সংস্করণ। Windows build ও runtime
পরীক্ষা সফল হওয়ার পরে তৈরি artifact ব্যবহার করতে হবে। শুধু source preview
দিয়ে database চালানো যায় না। [Build ও পরীক্ষার ফল](https://github.com/MohammadAtikurRahman/BsonLite/actions/workflows/modern-engine.yml)
দেখুন।

আধুনিক build-এর জন্য Windows x64 build 20348+ এবং Node.js 20.19+ প্রয়োজন।
বর্তমান `bsonlite-sdk@0.6.0-rc.3` পুরোনো engine-এর package; এই branch push
করলেই npm-এর সেই package বদলে যায় না।

## নতুন project

সফল workflow-এর artifact থেকে `dist-modern/BsonLite.cjs` নিন। আপনার project-এ
ফাইলটি রেখে আগের মতোই ব্যবহার করুন:

```js
const BsonLite = require('./BsonLite.cjs');

async function main() {
  try {
    await BsonLite.connect();
    await BsonLite.collection('users').insertOne({ name: 'Atik' });
    console.log(await BsonLite.collection('users').find({}).toArray());
  } finally {
    await BsonLite.disconnect();
  }
}
main().catch(console.error);
```

চলমান app-টি আগের BsonLite Console 0.2.0 ও CLI-এর automatic connection
তালিকায় দেখা যাবে। GUI software আলাদাভাবে চালাতে হবে। SDK নিজে GUI খুলবে না।

## পুরোনো database থাকলে

সব app বন্ধ করুন। পুরোনো `Database` ও তার protected vault রেখে দিন। একই
Windows account থেকে নিচের কাজ করুন। নতুন engine-কে পুরোনো directory খুলতে
দেবেন না; নতুন directory-তে logical upgrade করতে হবে।

পুরোনো SDK একটি আলাদা নামে ইনস্টল করুন:

```powershell
npm install bsonlite-previous@npm:bsonlite-sdk@0.6.0-rc.3
```

পরীক্ষায় পাস করা আধুনিক ফাইলটি `BsonLite-modern.cjs` নামে রেখে `upgrade.cjs`
তৈরি করুন:

```js
const previous = require('bsonlite-previous');
const modern = require('./BsonLite-modern.cjs');

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

নিজের শক্ত backup password দিয়ে `BSONLITE_BACKUP_PASSWORD` environment
variable সেট করে `node upgrade.cjs` চালান। `Database9` আগে থেকে থাকা চলবে না।

Upgrade BSON type, document count/digest, collection settings, index ও view
নিয়ে কাজ করে। সম্পূর্ণ হওয়ার আগে নতুন database সাধারণভাবে খোলা বন্ধ থাকে।
ব্যর্থ হলে পুরোনো data ব্যবহার করা যাবে। বিশেষ collation থাকলে ICU version-এর
পার্থক্য যাচাই করে তবেই `allowCollationUpgrade: true` ব্যবহার করতে হবে।

সফল হওয়ার পরে app-এ আধুনিক SDK এবং নতুন directory দিন:

```js
const BsonLite = require('./BsonLite-modern.cjs');
async function main() {
  await BsonLite.connect({ directory: './Database9' });
  // এখানে আপনার server বা desktop app চালু করুন।
}
main().catch(console.error);
```

নতুন data যাচাই করুন এবং নতুন encrypted backup রাখুন। পুরোনো database ও
backup সঙ্গে সঙ্গে মুছবেন না। পুরোনো format হলে আগে আগের SDK দিয়ে তার
documented migration শেষ করতে হবে।

পুরো build, পরীক্ষার সীমা ও matching modified engine source বিতরণের নিয়ম
[README](README.md)-তে আছে।
