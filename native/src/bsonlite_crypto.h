/* BsonLite native crypto bridge. MIT; see licenses/BsonLite-MIT.txt. */
#ifndef BSONLITE_CRYPTO_H
#define BSONLITE_CRYPTO_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define BSL_OVERHEAD 48u
#define BSL_FRAME_SIZE 56u
#define BSL_WIREDTIGER_DOMAIN 1u
#define BSL_TEMP_DOMAIN 2u
#define BSL_REMOVE_DOMAIN 3u
#define BSL_CIPHER_NAME "bsonlite_xchacha20_v1"
int bsonlite_key_ready(void);
const char *bsonlite_key_id(void);
int bsonlite_load_key(void);
int bsonlite_key_matches(const char *, size_t);
int bsonlite_encrypt(unsigned char, const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int bsonlite_decrypt(unsigned char, const uint8_t *, size_t, uint8_t *, size_t, size_t *);
int bsonlite_crypto_selftest(void);
#ifdef __cplusplus
}
#endif
#endif
