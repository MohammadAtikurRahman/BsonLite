"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const esbuild = require("esbuild");
const { builtinModules } = require("node:module");
const constants = require("../src/constants.cjs");
const { profiles, profileFor } = require("../src/engine-profiles.cjs");

async function main() {
  const profileArg = process.argv.find(value => value.startsWith("--engine-profile="));
  const profileName = profileArg ? profileArg.slice("--engine-profile=".length) : profileFor(constants.ENGINE_VERSION).id;
  const profile = Object.values(profiles).find(item => item.id === profileName);
  if (!profile) throw new Error("Unknown engine build profile: " + profileName);
  const ENGINE_VERSION = profile.version, VERSION = profile.sdkVersion;
  let installedDriver;
  try { installedDriver = require(profile.driverPackage + "/package.json"); }
  catch (_) { throw new Error("The selected database driver is missing. Run npm ci before building."); }
  if (installedDriver.name !== "mongodb" || installedDriver.version !== profile.driverVersion) {
    throw new Error("Installed database driver does not match " + profile.driverVersion + ". Run npm ci before building.");
  }
  const modern = profile.id === "modern";
  if (modern && (process.versions.node.split(".").map(Number)[0] < 20 ||
      (process.versions.node.startsWith("20.") && Number(process.versions.node.split(".")[1]) < 19))) {
    throw new Error("The modern SDK requires Node.js 20.19 or later.");
  }
  const root = path.resolve(__dirname, "..");
  const binary = path.resolve(process.env.BSONLITE_ENGINE_PATH ||
    path.join(root, "assets", modern ? "modern-win32-x64" : "native-win32-x64", "mongod.exe"));
  const platform = process.env.BSONLITE_BUILD_PLATFORM || "win32";
  const arch = process.env.BSONLITE_BUILD_ARCH || "x64";
  const sourceOnly=process.argv.includes("--preview-source");
  const dependencyNotices = require("./notices.cjs").collectNotices(root, { modern, driverPackage: profile.driverPackage });
  if (!sourceOnly&&!fs.existsSync(binary)) {
    throw new Error("The encrypted Windows engine has not been built. Run the native Windows workflow; an ordinary mongod.exe is not accepted as an encrypted engine.");
  }
  let notices = fs.readdirSync(path.join(root, "licenses"))
    .filter(function (name) { return /\.(txt|md)$/i.test(name); })
    .map(function (name) { return { name: name, text: fs.readFileSync(path.join(root, "licenses", name), "utf8") }; });
  if (modern) {
    notices = notices.filter(item => !item.name.startsWith("Dependency-") &&
      (!item.name.startsWith("MongoDB-") || item.name === "MongoDB-SSPL-1.0.txt"));
    for (const folder of [dependencyNotices, path.join(root, "licenses/modern")]) {
      if (!fs.existsSync(folder)) {
        if (!sourceOnly) throw new Error("Matching modern engine notices are missing: " + folder);
        continue;
      }
      for (const name of fs.readdirSync(folder)) if (/\.(txt|md)$/i.test(name)) {
        notices.push({name: "modern-" + name, text: fs.readFileSync(path.join(folder, name), "utf8")});
      }
    }
  }
  if (!notices.some(function (entry) { return entry.name === "MongoDB-SSPL-1.0.txt"; })) {
    throw new Error("MongoDB license text is missing; do not distribute the engine without its license.");
  }
  let nativeManifest;
  if(!sourceOnly){
    const file=path.resolve(process.env.BSONLITE_NATIVE_MANIFEST||path.join(path.dirname(binary),"native-engine.json"));
    await require("../src/native-storage.cjs").resolveNative(binary,{storageEncryption:"native",nativeManifest:file},profile);
    nativeManifest=JSON.parse(fs.readFileSync(file,"utf8"));
    if(nativeManifest.windowsCodePage!=="UTF-8"||nativeManifest.minimumWindowsBuild!==profile.minimumWindowsBuild)throw new Error("The engine's UTF-8 Windows process manifest has not been prepared for this engine profile.");
    if(nativeManifest.windowsIntegration!=="passed")throw new Error("The Windows native integration checks have not passed. Use npm run build:preview for source review; production bundling is blocked.");
    if (modern) {
      const archive = path.join(root, "native/build/modern/BsonLite-modern-engine-source.tar.gz");
      if (!fs.existsSync(archive) || !/^[a-f0-9]{64}$/.test(nativeManifest.sourceArchiveSha256 || "") ||
          crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== nativeManifest.sourceArchiveSha256)
        throw new Error("The matching modified modern engine source archive is missing or has changed.");
    }
  }
  const bytes = sourceOnly?Buffer.alloc(0):fs.readFileSync(binary);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const gzip = zlib.gzipSync(bytes, { level: 9 });
  const payload = sourceOnly?{sourcePreview:true,licenses:notices}:{
    version: ENGINE_VERSION, platform: platform, arch: arch, sha256: sha256,
    gzipBase64: gzip.toString("base64"), licenses: notices,nativeManifest
  };
  const outputArg = process.argv.find(value => value.startsWith("--outdir="));
  const dist = path.resolve(process.env.BSONLITE_BUILD_OUTDIR || (outputArg ? outputArg.slice("--outdir=".length) : path.join(root, "dist")));
  fs.mkdirSync(dist, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: ["src/index.cjs"],
    outfile: path.join(dist, "BsonLite.cjs"),
    bundle: true, platform: "node", format: "cjs", target: modern ? "node20.19" : "node20",
    sourcemap: false, minify: false, legalComments: "inline", metafile: true,
    banner: { js: "/* BsonLite " + VERSION + " | Engine MongoDB " + ENGINE_VERSION +
      " | " +(sourceOnly?"SOURCE PREVIEW: native Windows engine is not included. ":"Native encrypted engine. ")+"Node.js required | Third-party licenses accompany the project. */" },
    external: [
      "kerberos", "snappy", "@mongodb-js/zstd", "mongodb-client-encryption",
      "@aws-sdk/credential-providers", "gcp-metadata", "socks"
    ],
    plugins: [{
      name: "bsonlite-engine",
      setup: function (build) {
        build.onLoad({ filter: /[/\\]src[/\\]constants\.cjs$/ }, function () {
          return {contents: "module.exports = Object.freeze(" + JSON.stringify({ ...constants,
            VERSION, ENGINE_VERSION, DRIVER_VERSION: profile.driverVersion }) + ");", loader: "js"};
        });
        build.onResolve({filter: /^mongodb$/}, function () {
          return {path: require.resolve(profile.driverPackage)};
        });
        build.onResolve({ filter: /^\.\/payload\.cjs$/ }, function () {
          return { path: "embedded-engine", namespace: "bsonlite" };
        });
        build.onLoad({ filter: /.*/, namespace: "bsonlite" }, function () {
          return { contents: "module.exports = " + JSON.stringify(payload) + ";", loader: "js" };
        });
      }
    }]
  });
  const builtins = new Set(builtinModules);
  const runtimePackages = Object.values(result.metafile.outputs).flatMap(function (item) {
    return item.imports.filter(function (entry) {
      return entry.external && !entry.path.startsWith("node:") && !builtins.has(entry.path);
    })
      .map(function (entry) { return entry.path; });
  });
  const manifest = {
    bsonliteVersion: VERSION, engineVersion: ENGINE_VERSION,
    engineProfile: profile.id, driverVersion: profile.driverVersion,
    experimental: modern, minimumNodeVersion: modern ? "20.19.0" : "20.0.0",
    nativeReady:!sourceOnly,distributionMode:sourceOnly?"source-preview":"native-encrypted",
    platform: platform, arch: arch, engineSha256: sha256,
    engineBytes: bytes.length, compressedEngineBytes: gzip.length,
    distributionBytes: fs.statSync(path.join(dist, "BsonLite.cjs")).size,
    optionalFeaturesNotIncluded: Array.from(new Set(runtimePackages)),
    builtAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dist, "build-info.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const file of ["index.js", "users.js"]) {
    fs.copyFileSync(path.join(root, "examples", "starter", file), path.join(dist, file));
  }
  console.log("Built: " + path.join(dist, "BsonLite.cjs"));
  console.log("MongoDB " + ENGINE_VERSION + " / " + platform + "/" + arch);
  console.log("Mode: " + (sourceOnly ? "source-preview (native engine not included)" : "native-encrypted"));
  console.log("File size: " + (manifest.distributionBytes / 1048576).toFixed(2) + " MiB");
}
main().catch(function (error) { console.error(error.message); process.exitCode = 1; });
