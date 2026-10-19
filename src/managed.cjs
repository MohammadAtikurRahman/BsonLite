"use strict";
const path = require("node:path");
const { storagePaths } = require("./paths.cjs");
const { protectDirectory } = require("./permissions.cjs");
const roots = new Map();
function prepareManagedRoot() {
  const root = storagePaths().managedRoot;
  if (!roots.has(root)) roots.set(root, (async () => {
    // Protect parents as well as leaf vault/cache folders; never walk another live store.
    for (const folder of [root, path.join(root, "engines"), path.join(root, "stores")]) await protectDirectory(folder, [], false);
    return root;
  })().catch(error => { roots.delete(root); throw error; }));
  return roots.get(root);
}
module.exports = { prepareManagedRoot };
