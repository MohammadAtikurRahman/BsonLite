"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { protectDirectory } = require("./permissions.cjs");
const { atomicWrite } = require("./util.cjs");
require("reflect-metadata");
const x509 = require("@peculiar/x509");

async function createTLS(sessions) {
  // A fresh, private CA for this process lifetime; no public CA can impersonate it.
  x509.cryptoProvider.set(crypto.webcrypto);
  fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const directory = path.join(sessions, crypto.randomBytes(16).toString("hex"));
  await protectDirectory(directory, []);
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) };
  const keys = () => crypto.webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const [caKeys, serverKeys, clientKeys] = await Promise.all([keys(), keys(), keys()]);
  const validity = { notBefore: new Date(Date.now() - 5 * 60000), notAfter: new Date(Date.now() + 397 * 86400000), signingAlgorithm: algorithm };
  const caName = "CN=BsonLite Ephemeral CA,O=BsonLite";
  const ca = await x509.X509CertificateGenerator.createSelfSigned({ ...validity, name: caName, keys: caKeys,
    extensions: [new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(caKeys.publicKey)] });
  async function leaf(keyPair, server) {
    return x509.X509CertificateGenerator.create({ ...validity,
      subject: server ? "CN=localhost,O=BsonLite Server" : "CN=BsonLite Local Client,O=BsonLite Client",
      issuer: ca.subject, publicKey: keyPair.publicKey, signingKey: caKeys.privateKey,
      extensions: [new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
        new x509.ExtendedKeyUsageExtension([server ? x509.ExtendedKeyUsage.serverAuth : x509.ExtendedKeyUsage.clientAuth]),
        await x509.SubjectKeyIdentifierExtension.create(keyPair.publicKey),
        await x509.AuthorityKeyIdentifierExtension.create(caKeys.publicKey),
        ...(server ? [new x509.SubjectAlternativeNameExtension([{ type: "dns", value: "localhost" }, { type: "ip", value: "127.0.0.1" }])] : [])] });
  }
  const [server, client] = await Promise.all([leaf(serverKeys, true), leaf(clientKeys, false)]);
  async function pem(cert, pair) {
    const exported = Buffer.from(await crypto.webcrypto.subtle.exportKey("pkcs8", pair.privateKey));
    try { return crypto.createPrivateKey({ key: exported, format: "der", type: "pkcs8" }).export({ format: "pem", type: "pkcs8" }) + cert.toString("pem") + "\n"; }
    finally { exported.fill(0); }
  }
  const caFile = path.join(directory, "ca.pem"), serverFile = path.join(directory, "server.pem"), clientFile = path.join(directory, "client.pem");
  atomicWrite(caFile, ca.toString("pem") + "\n");
  atomicWrite(serverFile, await pem(server, serverKeys));
  atomicWrite(clientFile, await pem(client, clientKeys));
  return {
    directory, caFile, serverFile, clientFile, expiresAt: validity.notAfter.toISOString(),
    clientOptions: { tls: true, tlsCAFile: caFile, tlsCertificateKeyFile: clientFile },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}
module.exports = { createTLS };
