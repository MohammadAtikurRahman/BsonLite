"use strict";
class BsonLiteError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause: cause } : undefined);
    this.name = "BsonLiteError";
    this.code = code;
  }
}
function serialize(error) {
  return { code: error.code || "BSONLITE_START_FAILED", message: error.message || String(error) };
}
module.exports = { BsonLiteError, serialize };
