# BsonLite repository ও build

Private repository: [MohammadAtikurRahman/BsonLite](https://github.com/MohammadAtikurRahman/BsonLite), default branch `main`। আগের Portable-MongoDB repository অপরিবর্তিত আছে। নতুন repository-তে source, native engine patches, build scripts, tests ও documentation রাখা হয়েছে।

`main`-এ push হলে **Build native encrypted Windows SDK** চলবে। এটি pinned source থেকে custom engine তৈরি করে বা matching compiled cache নেয়; তারপর Windows unit/security checks, native encryption, encrypted spill files, backup/restore, migration এবং final single-file consumer পরীক্ষা করে। সব ধাপ সফল হলেই **BsonLite-native-Windows-x64-<commit>** artifact পাওয়া যাবে।

Artifact-এর `dist/BsonLite.cjs` engine-সহ SDK। `dist/index.js` ও `dist/users.js` starter example। `SHA256SUMS.txt`, `build-info.json` ও `validation.json`-এ hashes, build mode, commit এবং run reference থাকে। Licenses ও matching modified-engine source-ও একই artifact-এ থাকে। Source preview customer database হিসেবে ব্যবহার করবে না।

এই initial repository তৈরির helper আবার চালানোর দরকার নেই। পরের changes সাধারণ Git commit/push দিয়ে যাবে। Manual build: **Actions → Build native encrypted Windows SDK → Run workflow**। GitHub Release বা public/npm publication নিজে থেকে হয় না।

Build কাজ developer/CI-এর। Customer compiler, Python, EFS বা BitLocker command চালাবে না; desktop application-এর সঙ্গে compatible Node/runtime দেওয়া developer-এর কাজ। Distribution-এর আগে clean Windows Home/Pro এবং actual packaged app-এর পরীক্ষা ও security review বাকি থাকলে তা পরিষ্কারভাবে জানাবে।
