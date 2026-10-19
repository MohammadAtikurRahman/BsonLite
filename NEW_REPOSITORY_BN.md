# নতুন BsonLite repository

আলাদা private GitHub repository তৈরি হয়েছে: [MohammadAtikurRahman/BsonLite](https://github.com/MohammadAtikurRahman/BsonLite)। Default branch `main`। Source ও workflows আপলোড হয়েছে এবং Windows build চলছে। SDK/DPAPI/ACL/Unicode helper checks পাস করেছে। আসল engine ও integration tests সফল হওয়ার পর ব্যবহারযোগ্য encrypted SDK পাওয়া যাবে।

Repository-তে source প্রকাশ হয়ে গেলে নিচের initial-publishing helper আবার চালানোর দরকার নেই। পরবর্তী পরিবর্তন স্বাভাবিক Git commit/push দিয়ে যাবে।

## Developer-এর জন্য প্রকাশ করা

তোমার Windows developer PC-তে Git ও GitHub CLI থাকলে project folder থেকে একবার চালাবে:

```powershell
powershell -NoProfile -File .\scripts\Publish-GitHub.ps1
```

Helper প্রয়োজন হলে GitHub-এর নিজস্ব browser login খুলবে এবং build workflow upload করার scope চাইবে। নিজের `MohammadAtikurRahman` account ব্যবহার করবে। এটি `BsonLite` নামে **private** repository তৈরি করবে, অথবা একই নামে আগে তৈরি করা খালি repository ব্যবহার করবে। Public করতে চাইলে `-Visibility public` যোগ করতে পারো। আগে থেকেই commit থাকা remote-তে এটি push করবে না। কোনো force-push বা token copy করে না। আগে থেকে GitHub CLI login করা থাকলে account-এর workflow write permission-ও থাকতে হবে।

GitHub CLI download: https://cli.github.com/

অথবা GitHub-এ খালি repo তৈরি করার লিংক: https://github.com/new?name=BsonLite

খালি repo তৈরি করলে README, license বা gitignore যোগ করবে না। Source পাঠানোর আগে repository URL এবং connection-এর write access প্রয়োজন।

## Code push হওয়ার পরে

`main` branch-এ push হলেই **Build native encrypted Windows SDK** workflow শুরু হবে। এটি MongoDB 4.0.28 source থেকে patched Windows engine তৈরি করবে এবং native encryption, backup/restore, migration, temporary spill files ও standalone CJS পরীক্ষা করবে। Build ব্যর্থ হলে customer artifact প্রকাশ করবে না।

সফল run-এর **Artifacts → BsonLite-native-Windows-x64-…** download করবে। এর `dist/BsonLite.cjs` হবে engine-সহ SDK। `dist/SHA256SUMS.txt` ও `dist/validation.json`-এ hashes, commit এবং test-run reference থাকবে। Matching modified-engine source ও licenses-ও artifact-এ থাকবে। GitHub Release বা public package নিজে থেকে প্রকাশ হয় না।

এই কাজ developer/CI-এর। তোমার customer শুধু packaged app ব্যবহার করবে; তাকে GitHub, compiler, Python, EFS বা BitLocker command চালাতে হবে না। Customer delivery-এর আগে clean Windows Home/Pro ও নিজের packaged desktop app পরীক্ষা এখনো প্রয়োজন।
