"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const esbuild = require("esbuild");
const { builtinModules } = require("node:module");
const { ENGINE_VERSION, VERSION } = require("../src/constants.cjs");

async function main() {
  const root = path.resolve(__dirname, "..");
  const binary = path.resolve(process.env.BSONLITE_ENGINE_PATH ||
    path.join(root, "assets", "native-win32-x64", "mongod.exe"));
  const platform = process.env.BSONLITE_BUILD_PLATFORM || "win32";
  const arch = process.env.BSONLITE_BUILD_ARCH || "x64";
  const sourceOnly=process.argv.includes("--preview-source");
  require("./notices.cjs").collectNotices(root);
  if (!sourceOnly&&!fs.existsSync(binary)) {
    throw new Error("The encrypted Windows engine has not been built. Run the native Windows workflow; an ordinary mongod.exe is not accepted as an encrypted engine.");
  }
  const notices = fs.readdirSync(path.join(root, "licenses"))
    .filter(function (name) { return /\.(txt|md)$/i.test(name); })
    .map(function (name) { return { name: name, text: fs.readFileSync(path.join(root, "licenses", name), "utf8") }; });
  if (!notices.some(function (entry) { return entry.name === "MongoDB-SSPL-1.0.txt"; })) {
    throw new Error("MongoDB license text is missing; do not distribute the engine without its license.");
  }
  let nativeManifest;
  if(!sourceOnly){
    const file=path.resolve(process.env.BSONLITE_NATIVE_MANIFEST||path.join(path.dirname(binary),"native-engine.json"));
    await require("../src/native-storage.cjs").resolveNative(binary,{storageEncryption:"native",nativeManifest:file});
    nativeManifest=JSON.parse(fs.readFileSync(file,"utf8"));
    if(nativeManifest.windowsIntegration!=="passed")throw new Error("The Windows native integration checks have not passed. Use npm run build:preview for source review; production bundling is blocked.");
  }
  const bytes = sourceOnly?Buffer.alloc(0):fs.readFileSync(binary);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const gzip = zlib.gzipSync(bytes, { level: 9 });
  const payload = sourceOnly?{sourcePreview:true,licenses:notices}:{
    version: ENGINE_VERSION, platform: platform, arch: arch, sha256: sha256,
    gzipBase64: gzip.toString("base64"), licenses: notices,nativeManifest
  };
  const dist = path.resolve(process.env.BSONLITE_BUILD_OUTDIR || path.join(root, "dist"));
  fs.mkdirSync(dist, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: ["src/index.cjs"],
    outfile: path.join(dist, "BsonLite.cjs"),
    bundle: true, platform: "node", format: "cjs", target: "node20",
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
  console.log("File size: " + (manifest.distributionBytes / 1048576).toFixed(2) + " MiB");
}
main().catch(function (error) { console.error(error.message); process.exitCode = 1; });
