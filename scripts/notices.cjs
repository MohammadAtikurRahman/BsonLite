"use strict";
const fs = require("node:fs");
const path = require("node:path");

function collectNotices(root, options = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const folder = path.join(root, "licenses", ...(options.modern ? ["modern-sdk"] : []));
  fs.mkdirSync(folder, { recursive: true });
  // Acorn is already embedded in the Console adapter; it is not installed as a
  // package in this repository and must survive lockfile notice regeneration.
  for (const name of fs.readdirSync(folder)) if (name.startsWith("Dependency-") && !name.startsWith("Dependency-acorn-")) fs.unlinkSync(path.join(folder, name));
  const modernDependencies = new Set();
  if (options.modern) {
    function visit(source) {
      source = fs.realpathSync(source);
      if (modernDependencies.has(source)) return;
      modernDependencies.add(source);
      const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
      for (const name of Object.keys(pkg.dependencies || {})) {
        let resolved;
        try { resolved = path.dirname(require.resolve(name + "/package.json", { paths: [source] })); }
        catch (_) { resolved = path.dirname(require.resolve(name, { paths: [source] })); }
        while (!fs.existsSync(path.join(resolved, "package.json"))) resolved = path.dirname(resolved);
        visit(resolved);
      }
    }
    visit(path.join(root, "node_modules/mongodb-modern"));
  }
  const manifest = [];
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative) continue;
    const source = path.join(root, relative);
    if (entry.dev && !modernDependencies.has(path.resolve(source))) continue;
    if (!fs.existsSync(path.join(source, "package.json"))) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    const names = fs.readdirSync(source).filter(name => /^(licen[sc]e|copying|copyright|notice)/i.test(name) && fs.statSync(path.join(source, name)).isFile());
    if (!names.some(name => /^(licen[sc]e|copying)/i.test(name))) throw new Error("A dependency license is missing: " + pkg.name);
    const prefix = (pkg.name + "-" + pkg.version).replace(/[^a-zA-Z0-9_.-]/g, "_");
    for (const name of names) fs.copyFileSync(path.join(source, name), path.join(folder, "Dependency-" + prefix + "-" + name.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".txt"));
    manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license || "See notice", source: pkg.repository || pkg.homepage || "See installed npm package" });
  }
  fs.writeFileSync(path.join(folder, "Dependency-VERSIONS.md"), "# Bundled dependency versions\n\nGenerated from package-lock.json. Original license/copyright texts accompany this file.\n\n" + manifest.map(pkg => "- " + pkg.name + " " + pkg.version + " — " + JSON.stringify(pkg.license)).join("\n") + "\n");
  return folder;
}
module.exports = { collectNotices };
