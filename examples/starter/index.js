const http = require("node:http");
const BsonLite = require("./BsonLite.cjs");
let server;
let closing;

async function main() {
  // Requires the final Windows artifact produced by the native build workflow.
  // The source preview has no rebuilt Windows engine. See START_HERE_BN.md.
  // In the final artifact, ports, TLS, credentials and encryption are automatic.
  await BsonLite.connect();
  if (closing) return;
  server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/health") {
      try {
        await BsonLite.ping();
        const { name, port, security } = BsonLite.status();
        response.end(JSON.stringify({ ok: true, database: name, databasePort: port, tls: security.tls }));
      } catch (_) { response.statusCode = 503; response.end(JSON.stringify({ ok: false })); }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535.");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.info("[App] Server running | http://127.0.0.1:" + server.address().port + "/health");
  // Other files can now call require('./users.js').addUser({name:'Atik'}).
  // Startup does not insert data or print database documents.
}
function shutdown() {
  if (closing) return closing;
  closing = (async () => {
    if (server && server.listening) {
      await new Promise(resolve => {
        const timer = setTimeout(() => server.closeAllConnections(), 5000);
        server.close(() => { clearTimeout(timer); resolve(); });
      });
    }
    await BsonLite.stop();
    console.info("[BsonLite] Stopped");
  })().catch(error => { console.error(error.code || "BSONLITE_ERROR", error.message); process.exitCode = 1; });
  return closing;
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
main().catch(async error => {
  console.error(error.code || "BSONLITE_ERROR", error.message);
  await shutdown();
  process.exitCode = 1;
});
