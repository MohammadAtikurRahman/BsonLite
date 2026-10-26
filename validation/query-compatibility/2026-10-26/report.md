# BsonLite query compatibility audit

Run: https://github.com/MohammadAtikurRahman/Bsonlite-SDK/actions/runs/40262963488

Commit: a58d3883afc38ecd5e77e45450834ff0156ead88

Published npm: 0.7.0-alpha.1; embedded SDK: 0.7.0-alpha.0; expected Community: 9.0.4.

Cases completed: 333. Full per-case canonical BSON results and errors are in report.json.

| Classification | Cases |
| --- | ---: |
| match | 323 |
| expected-error-match | 5 |
| profile-limit | 3 |
| standalone-limit | 2 |

| Category | Results |
| --- | --- |
| find | match: 38 |
| projection | match: 9 |
| cursor | match: 11 |
| bson | match: 21 |
| aggregation | match: 23 |
| expression | match: 122 |
| update | match: 26 |
| write | match: 3 |
| index | match: 13, expected-error-match: 1 |
| geo | match: 3 |
| collection | match: 6, expected-error-match: 1 |
| error | expected-error-match: 3 |
| profile | profile-limit: 3 |
| topology | standalone-limit: 2 |
| complex | match: 8 |
| combinations | match: 40 |

## Differences and rejected cases

- **profile/where-js** (profile-limit): BsonLite 6108304: no globalScriptEngine in $where parsing; Community succeeded.
- **profile/function-js** (profile-limit): BsonLite 31264: Executor error during aggregate command on namespace: query_compat.people :: caused by :: Cannot run server-side javascript without the javascript engine enabled; Community succeeded.
- **profile/accumulator-js** (profile-limit): BsonLite 31264: Executor error during aggregate command on namespace: query_compat.people :: caused by :: Cannot run server-side javascript without the javascript engine enabled; Community succeeded.
- **topology/change-stream** (standalone-limit): BsonLite 40573: The $changeStream stage is only supported on replica sets or mongos; Community 40573: The $changeStream stage is only supported on replica sets or mongos.
- **topology/transaction** (standalone-limit): BsonLite 20: Transaction numbers are only allowed on a replica set member or mongos; Community 20: Transaction numbers are only allowed on a replica set member or mongos.

## Scope

- Finite regression matrix, not exhaustive Community feature parity.
- No cluster, replica-set, Atlas or mongosh parity claim.
- No performance, power-loss or independent security certification.
- Comparison preserves driver-decoded BSON via canonical EJSON, normalizes object-key order and preserves array order. Server-side $type is checked separately.
- Random sample/rand and currentDate tests compare validity contracts, not identical random values or timestamps.

Generated durations are diagnostic timing only, not a performance benchmark.
