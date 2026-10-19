const BsonLite = require("./BsonLite.cjs");

async function addUser(user) {
  if (!user || typeof user.name !== "string" || !user.name.trim() || user.name.length > 100) {
    throw new TypeError("name must be a non-empty string of at most 100 characters.");
  }
  // Select allowed fields instead of copying an HTTP request body into a document.
  return BsonLite.collection("users").insertOne({
    name: user.name.trim(), createdAt: new Date()
  });
}

async function findUser(id) {
  return BsonLite.collection("users").findOne({ _id: new BsonLite.ObjectId(id) });
}

module.exports = { addUser, findUser };
