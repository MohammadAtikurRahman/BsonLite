import BsonLite from "../dist/BsonLite.cjs";
await BsonLite.connect();
try {
  await BsonLite.collection("users").insertOne({ name: "Atik" });
} finally { await BsonLite.stop(); }
