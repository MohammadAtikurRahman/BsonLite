# Query compatibility audit — 26 October 2026

BsonLite npm **0.7.0-alpha.1** (embedded SDK **0.7.0-alpha.0**) was compared with the official **MongoDB Community 9.0.4** server on Windows Server 2022 using Node.js 24.22.1 and MongoDB driver 7.7.0 on both sides. The BsonLite side used the actual published package and its native encrypted store, not a source preview or mock.

**333 cases completed. No unexpected query/result differences or unexplained shared rejections were found in this matrix.** This is evidence for the tested cases, not a claim of complete Community feature parity.

## Evidence

This core repository preserves the exact report bytes from the published-package audit. Its original run and test implementation are hosted in the npm SDK repository. The package's preserved native/runtime evidence identifies core baseline `69920051901246994896c1bc53cc5f32bacaabd3`; the tested standalone SDK SHA-256 is `bc5a3cd20dc217c0a4c0255921dad687aa94844fe1730a6ad51bf56b50a83172`. The raw report SHA-256 is `28a0f57a044388aefa8588b6b59a383fc2e4ca6b708b8000a4e271d5f7c92e63`.

- [Successful Windows run](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/actions/runs/40262963488).
- Tested suite commit: [`a58d3883afc38ecd5e77e45450834ff0156ead88`](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/tree/a58d3883afc38ecd5e77e45450834ff0156ead88).
- [Full per-case results, canonical driver-decoded BSON and errors](validation/query-compatibility/2026-10-26/report.json).
- [Generated report](validation/query-compatibility/2026-10-26/report.md).
- [Runner](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/a58d3883afc38ecd5e77e45450834ff0156ead88/scripts/query-compatibility.cjs), [operator cases](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/a58d3883afc38ecd5e77e45450834ff0156ead88/scripts/query-compatibility-cases.cjs), [combined/oracle/spill cases](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/a58d3883afc38ecd5e77e45450834ff0156ead88/scripts/query-compatibility-extra.cjs).

## Results

| Classification | Cases | Meaning |
| --- | ---: | --- |
| Matching successful outcomes | 323 | Returned values, mutation results, index specifications or explicit validity contracts matched |
| Matching expected errors | 5 | Duplicate keys, invalid validation input, malformed query/projection were rejected as expected |
| BsonLite JavaScript profile limits | 3 | Community succeeded; the BsonLite profile rejected JavaScript execution |
| Shared standalone limits | 2 | Both standalone configurations rejected change streams and transactions |
| Unexpected differences | 0 | None observed in this finite matrix |

## Coverage

| Category | Cases | Outcomes |
| --- | ---: | --- |
| find | 38 | match: 38 |
| projection | 9 | match: 9 |
| cursor | 11 | match: 11 |
| bson | 21 | match: 21 |
| aggregation | 23 | match: 23 |
| expression | 122 | match: 122 |
| update | 26 | match: 26 |
| write | 3 | match: 3 |
| index | 14 | match: 13, expected-error-match: 1 |
| geo | 3 | match: 3 |
| collection | 7 | match: 6, expected-error-match: 1 |
| error | 3 | expected-error-match: 3 |
| profile | 3 | profile-limit: 3 |
| topology | 2 | standalone-limit: 2 |
| complex | 8 | match: 8 |
| combinations | 40 | match: 40 |

Coverage includes filtering, nested and array queries, projections, cursor behavior, BSON values and server-side types, arithmetic/string/date/array/object/set expressions, lookup/graphLookup/facet/unionWith pipelines, ranking and windows, percentile/median, densify/fill, updates and arrayFilters, bulk writes, text/geospatial indexes, validators, capped collections, time series, views, $out and $merge. TTL checks cover index definitions, not timed expiration.

Forty compound queries were also checked against independent deterministic JavaScript expectations. Combined analytics exercise joins, unwind, grouping, window output and facets in the same pipeline. Sample/rand and currentDate cases compare validity contracts; identical random results and wall-clock timestamps are not expected.

### Real disk spill

The sort case inserts **22,000 documents** containing **157,761,997 payload bytes**. It requires execution statistics to confirm actual disk spill on both engines, then compares the aggregate output. Both reported `usedDisk: true`, with equal counts, payload-byte totals, rank sums and first/last document IDs. This is a correctness/spill test, not a speed benchmark or a fresh cryptographic audit of spill files.

## Confirmed differences and configuration limits

| Operation | BsonLite | Community standalone |
| --- | --- | --- |
| `$where` | Error 6108304: no globalScriptEngine | Succeeded |
| `$function` | Error 31264: JavaScript engine disabled | Succeeded |
| JavaScript `$accumulator` | Error 31264: JavaScript engine disabled | Succeeded |
| `$changeStream` | Error 40573 | Error 40573 |
| Multi-document transaction | Error 20 | Error 20 |

The final two are topology limits: Community can offer those capabilities with the required replica-set/sharded configuration. They are not demonstrated query-engine regressions specific to BsonLite. Atlas services and full mongosh behavior are outside this test.

## Method and boundaries

- Both servers report version 9.0.4. They are different binaries: BsonLite is a custom build (`gitVersion: nogitversion`), and the official Community binary reports `64ade602b836c9adeffba7fa038c887ffab56196`. Binary and SDK hashes are retained in the report.
- Both use a standalone topology and a database-scoped `readWrite` application role, with `w: 1`, journaling and retryWrites disabled. BsonLite retains its native encryption, mutual TLS and account-bound vault; Community uses authenticated loopback access.
- The published SDK checksum is checked against its preserved validation record before any query is run. The official Windows Community ZIP is checked against SHA-256 `1e6234c8c33e75de3659a7e1104cb12f1cb68ae41cba60b625537c1ed9256d43`.
- Comparison uses canonical EJSON after driver decoding, sorts object keys, and retains array order. It does not establish byte-for-byte wire BSON or field-order identity. BSON round trips and server-side `$type` are checked separately.
- Every test has a BsonLite outcome and a Community outcome. Unexpected shared rejections fail the run instead of being counted as passing query support.
- Tests use synthetic data in new temporary stores on a disposable runner. Production databases are not used.
- This matrix does not cover every operator option, every BSON edge case, large-data workload, failure mode, deployment topology, GridFS/tooling surface, or the Console interpreter. It does not establish performance superiority over SQLite or security certification.

## Reproduce

The [workflow](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/a58d3883afc38ecd5e77e45450834ff0156ead88/.github/workflows/query-compatibility.yml) installs the pinned published package and matching driver, verifies/downloads the official Community binary and runs the suite on Windows. It preserves reports even when tests fail.

For manual execution on supported Windows, inside a disposable [SDK repository checkout](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/tree/a58d3883afc38ecd5e77e45450834ff0156ead88):

```powershell
New-Item -ItemType Directory -Force .query-runtime | Out-Null
Set-Content .query-runtime/package.json '{"name":"bsonlite-query-validation","private":true}'
npm install --prefix .query-runtime --ignore-scripts --no-audit --no-fund bsonlite-sdk@0.7.0-alpha.1 mongodb@7.7.0
$env:COMMUNITY_BINARY = "C:\path\to\official-9.0.4\mongod.exe"
node scripts/query-compatibility.cjs
```

The runner refuses non-Windows execution of the published native package. A nonzero exit means an unexpected difference, unexplained rejection or infrastructure failure; inspect `query-report/report.json`. Do not interpret a partial or failed run as complete parity.
