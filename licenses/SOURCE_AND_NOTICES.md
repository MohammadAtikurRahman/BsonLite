# Source and component notices — BsonLite native preview

The 0.6 engine is a modified MongoDB Community Server 4.0.28 / WiredTiger 3.1.1 build. It is not byte-identical to the earlier stock executable. Upstream commit: af1a9dc12adcfa83cc19571cb3faba26eeddac92.

Pinned upstream source, dependency URLs and checksums are in native/deps.lock.json. All native code, patches and build scripts are provided in native/. A binary CI artifact must include native/build/BsonLite-native-engine-source.tar.gz, containing the exact patched MongoDB sources, added encryptor sources, pinned libsodium source archive and build support.

MongoDB-SSPL-1.0.txt retains the upstream Server Side Public License. MongoDB-THIRD-PARTY-NOTICES.txt, MongoDB-MPL-2.txt and MongoDB-README.txt retain notices from the original archive; custom-engine sources retain their original notices as well. The SDK's MIT license does not relicense MongoDB or remove corresponding-source obligations. Do not distribute a custom binary without its applicable notices and matching source access.

libsodium 1.0.22 is ISC licensed; see libsodium-LICENSE.txt. Its version and verified release digest are pinned in native/deps.lock.json. Builder-only Python/wheels are not part of the customer CJS. Their downloaded archives retain their own licenses on the build host.

The Node driver remains mongodb 6.16.0. Exact npm versions are in package-lock.json and Dependency-VERSIONS.md. Dependency-*.txt files retain installed package license texts. The BsonLite JavaScript wrapper and new standalone native bridge sources are MIT licensed; modified upstream files retain their upstream license headers.

This source-preview bundle contains no rebuilt Windows executable. A production-format bundle is blocked until native Windows validation succeeds.
