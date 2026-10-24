"use strict";

// A build selects one pinned profile. Environment variables never change a
// customer's engine or permit an unrecognised executable to open a store.
const profiles = Object.freeze({
  "4.0.28": Object.freeze({
    id: "legacy", version: "4.0.28", manifestVersion: 1,
    upstreamCommit: "af1a9dc12adcfa83cc19571cb3faba26eeddac92",
    minimumWindowsBuild: 18362, driverVersion: "6.16.0", driverPackage: "mongodb",
    sdkVersion: "0.6.0-rc.1", selfTestProtocol: "win32-exit-code-v1"
  }),
  "9.0.4": Object.freeze({
    id: "modern", version: "9.0.4", manifestVersion: 2,
    upstreamCommit: "246de92935f8636f4f90889d418b31ae70dbaafd",
    minimumWindowsBuild: 20348, driverVersion: "7.7.0", driverPackage: "mongodb-modern",
    sdkVersion: "0.7.0-alpha.0", selfTestProtocol: "json-v1"
  })
});

function profileFor(version) {
  if (!Object.hasOwn(profiles, version)) throw new Error("Unsupported BsonLite engine profile: " + version);
  return profiles[version];
}

function startupArguments(options, tls, version) {
  const profile = profileFor(version);
  const flags = ["--dbpath", require("node:path").join(options.directory, "data"),
    "--port", String(options.port), "--bind_ip", "127.0.0.1"];
  if (profile.id === "modern") flags.push("--tlsMode", "requireTLS", "--tlsCertificateKeyFile", tls.serverFile,
    "--tlsCAFile", tls.caFile, "--tlsDisabledProtocols", "TLS1_0,TLS1_1");
  else flags.push("--sslMode", "requireSSL", "--sslPEMKeyFile", tls.serverFile,
    "--sslCAFile", tls.caFile, "--sslDisabledProtocols", "TLS1_0,TLS1_1");
  flags.push("--auth", "--storageEngine", "wiredTiger", "--noscripting", "--profile", "0",
    "--slowOpSampleRate", "0", "--setParameter", "authenticationMechanisms=SCRAM-SHA-256",
    "--wiredTigerCacheSizeGB", String(options.cacheSizeGB),
    "--setParameter", "diagnosticDataCollectionEnabled=false");
  if (profile.id === "legacy") flags.push("--enableFreeMonitoring", "off");
  if (process.platform !== "win32") flags.push("--nounixsocket");
  return flags;
}

module.exports = { profiles, profileFor, startupArguments };
