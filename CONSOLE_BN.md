# এখন শুধু app চালাও → Connect চাপো

## একবার SDK আপডেট

**Single-file app:** তোমার আগের `BsonLite.cjs` file-এর জায়গায় দেওয়া নতুন file বসাবে। আগের `require(...)`, database name/directory এবং `BsonLite.connect(...)` code একই থাকবে। আলাদা helper install বা নতুন connection code লাগবে না।

**npm app:** existing app-এর terminal-এ দেওয়া package-এর সঠিক path দিয়ে একবার:

```powershell
npm install "F:\Downloads\BsonLite-Easy-Connect\SDK\bsonlite-sdk-0.6.0-rc.3.tgz"
```

নিজের extract করা location অনুযায়ী path বদলাবে। এটি SDK update; আলাদা helper নয়। নতুন npm version এখনো registry-তে publish করা হয়নি, তাই এই file থেকে install করবে।

## এরপর প্রতিবার

১. নিজের app আগের মতো চালাও ও চালু রাখো।
২. `BsonLite-Console-0.2.0-Windows-x64.exe` চালাও।
৩. চলমান database নিজে থেকেই dropdown-এ দেখা যাবে এবং URL বসে যাবে। **Connect** চাপো।

একাধিক app/database থাকলে dropdown থেকে বেছে নেবে। কোনো app চালু না থাকলে app চালু করতে বলবে; বন্ধ database বা PC-এর সব data folder নিজে খুলবে না। একই Windows account ব্যবহার করবে। Console বন্ধ করলেও মূল app বন্ধ হবে না।

Documents, filter/sort, JSON view, indexes এবং query console আগের মতো থাকবে। Insert/update/delete করতে Options থেকে Read-only বন্ধ করে Apply options চাপবে।

CLI ব্যবহার করলে একটি database চললে সেটি নিজে পাবে, একাধিক থাকলে list থেকে number বেছে নেবে।

আগের standalone native SDK/engine-এর bytes অক্ষত রেখে Console feature যোগ হয়েছে। Native Windows SDK-এর সঙ্গে নতুন flow Windows-এ চালিয়ে পরীক্ষা এখনও বাকি; এখানে automated discovery, SDK API এবং Electron workflow পরীক্ষা করা হচ্ছে। বিস্তারিত VALIDATION.md-এ থাকবে।
