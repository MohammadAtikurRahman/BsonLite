'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const record = require('./PROVENANCE.json');
assert.equal(record.repository, 'MohammadAtikurRahman/BsonLite-Console');
assert.equal(record.commit, 'd03a5898a976280833653117b9a071d6bd4097ef');
const expected = ['LICENSE', 'bin/bsonlite.cjs', 'src/connection.cjs', 'src/discovery-path.cjs', 'src/discovery.cjs', 'src/execute.cjs', 'src/query.cjs'];
assert.deepEqual(Object.keys(record.files).sort(), expected);
for (const name of expected) {
  const file = path.join(__dirname, name), stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe compatibility fixture: ' + name);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), record.files[name], 'Console fixture differs from the pinned source: ' + name);
}
const pkg = require('./package.json');
assert.equal(pkg.private, true);
assert.deepEqual(pkg.dependencies, { acorn: '8.19.0', mongodb: '6.16.0' });
console.log('Verified pinned Console 0.2.0 CLI compatibility fixture.');
