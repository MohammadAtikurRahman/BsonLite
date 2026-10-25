# Source and component notices

The default 0.7 core uses a modified MongoDB Community 9.0.4 / WiredTiger 12 engine, upstream commit `246de92935f8636f4f90889d418b31ae70dbaafd`. Its matching source archive is `native/build/modern/BsonLite-modern-engine-source.tar.gz` in the full artifact, or `source/BsonLite-modern-engine-source.tar.gz` in the prepared npm package.

The explicit legacy profile uses MongoDB 4.0.28 / WiredTiger 3.1.1, upstream commit `af1a9dc12adcfa83cc19571cb3faba26eeddac92`, with its separate matching legacy source archive. Profiles do not share physical database formats.

The JavaScript wrapper and BsonLite additions are MIT licensed; the modified engine remains SSPL-1.0. libsodium and JavaScript dependencies retain the original license and notice texts distributed beside the SDK. The wrapper does not relicense the engine. Preserve matching modified source and notices with every distributed native engine.

`build-info.json`, `native-engine.json` and `validation.json` identify the actual engine/profile, source hashes and successful test run. Source previews contain no native executable. Historical validation records belong to their exact commits and artifacts. See the repository test evidence for scope and limitations.
