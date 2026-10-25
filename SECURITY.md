# Security model

Release candidate. Native Windows evidence belongs to the exact artifact's successful CI run in validation.json. No independent security audit is claimed.

The current default is engine 9.0.4 with driver 7.7.0. MongoDB 4.0.28 is retained only for explicitly selected legacy compatibility builds. MongoDB lists the 4.0 server line as end-of-life on April 30, 2022: https://www.mongodb.com/legal/support-policy/lifecycles. This custom encryption layer does not supply upstream server security maintenance. Loopback/mTLS limits exposure but does not replace that maintenance.

## Storage design

- WiredTiger encryptor: libsodium 1.0.22, XChaCha20-Poly1305, random 192-bit nonce for every encrypted block, 256-bit per-store random key, 128-bit authentication tag. Format is magic `BSLAE001` + 24-byte nonce + ciphertext + tag, 48-byte overhead.
- AEAD associated data binds the format header, public key id and usage domain (WiredTiger / temporary / RemoveSaver). Existing WiredTiger checksums remain enabled. The format does not bind a block to an authenticated file offset or implement monotonic anti-rollback. Replay of previously valid ciphertext is outside the current guarantee; this needs review before production.
- The full source patch registers the encryptor as a built-in before WiredTiger recovery, patches MongoDB temporary-data hooks, and appends mandatory native encryption after user collection/index configuration.
- A Linux loadable-extension prototype exercises the real old engine and the cipher ABI. It lacks the MongoDB C++ patches, so it is never accepted as full native mode or labeled fully verified.
- Process stdout/stderr diagnostics are written as bounded authenticated AES-256-GCM records using a separate HKDF-derived per-log key. Logs are best effort and capped; authentication does not prove a crash-truncated log is complete.
- Header files, key identifiers, folder names, sizes, public database names and non-sensitive engine metadata are visible. Encryption is not folder hiding.

## Keys and access

Each native database has independent random data-key bytes and a separate public key id. The key is stored with root credentials inside the protected vault: DPAPI CurrentUser on Windows; scrypt + AES-256-GCM for non-Windows source development. No fixed vendor/master recovery key is embedded.

The supervisor hands the engine a single 56-byte binary frame through stdin and closes the pipe. Key material is not placed in engine arguments, environment or a raw-key file. The input frame is zeroed after loading and the native key slot must be memory-lockable. MongoDB's `quickExit` / `TerminateProcess` path bypasses CRT exit callbacks, so this engine retains the locked key slot until process termination; it does not promise explicit key-slot erasure on shutdown. JavaScript strings, active record/index caches and OS crash mechanisms do not have the same memory-lock guarantee.

Normal application code receives a rotating readWrite account for its named database. Root credentials and the data key stay in the supervisor/native processes. The program author and same-account malware can still inspect process memory or use authorized APIs. Local admin compromise, pagefiles, hibernation, crash dumps, compromised runtimes and memory scraping are outside a file-encryption guarantee.

Mutual TLS, loopback-only binding, SCRAM-SHA-256, disabled scripting/profiling/diagnostic collection, private filesystem permissions and token-owned locks remain in place. TLS leaf private keys are ACL-protected temporary files; they are not falsely labeled DPAPI-encrypted.

The custom Windows engine removes MongoDB's own minidump writer, and the builder rejects a binary importing `MiniDumpWriteDump`. This prevents that engine feature from writing process memory beside the executable. Windows-managed dump policies, the Node.js process, pagefiles and hibernation remain outside this protection.

## Failure, migration and recovery

Native mode is the new default and fails closed if the rebuilt engine/manifest/self-test is absent or incompatible. Existing plaintext data is never made encrypted by changing a flag. Native stores reject `none`; earlier strict OS policies remain enforced in earlier-format access.

Migration creates a new database and copies through authenticated TLS. It preserves the original user records, rejects unsupported special collections, and leaves a persistent incomplete marker on interrupted copies. It does not securely erase the old copy or support every administrative/server-wide MongoDB object.

Native backups authenticate and encrypt their data key, cipher/key-id metadata, file manifest and raw encrypted data. Restore authenticates before creating files, retains cipher settings, chooses a new store identity and protects the key for the destination account. Loss of all keys/backups/passwords has no bypass.

Do not steal incomplete/live locks or delete data to solve startup errors. `recover()` only removes provably stale owned locks. This is not a power-loss/disk-full durability certification.

## Release requirements

The Windows workflow must compile and test the actual full engine, including actual aggregation spill files and a standalone CJS consumer. A clean Windows Home/Pro PC, parent Electron packaging, native prerequisites, crash/power-loss behavior, restore procedures and independent cryptography/storage review remain release gates beyond CI. Source-preview bundles contain no encrypted Windows executable; delivered native artifacts must have a matching successful validation record.
