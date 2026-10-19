const BsonLite = require("../dist/BsonLite.cjs");
(async () => {
  await BsonLite.connect();
  try {
    await BsonLite.collection("users").insertOne({ name: "Atik" });
    // Process or return results in your app; BsonLite never prints them itself.
    const count = await BsonLite.collection("users").countDocuments();
    console.info("Saved users:", count);
  } finally { await BsonLite.stop(); }
})().catch(error => { console.error(error.code, error.message); process.exitCode = 1; });
