# Pinned Console compatibility fixture

These seven MIT source/license files are copied byte for byte from BsonLite
Console commit `d03a5898a976280833653117b9a071d6bd4097ef`. `PROVENANCE.json`
records their SHA-256 hashes; `node verify.cjs` verifies them before CI installs
the exact production dependencies with `npm ci --ignore-scripts`.

The fixture contains the real terminal CLI and the connection/query modules
used by Console 0.2.0. Core engine validation can run without cross-repository
credentials. Its package is private and contains no Electron build or UI.
This is test input; the SDK continues to embed its existing Console adapter.

Update from the authoritative Console source when deliberately changing the
compatibility target. Preserve the license, pin the commit and file hashes,
and rerun both the typed BSON bridge and actual Windows engine/CLI tests.
