/* BsonLite WiredTiger 3.1.1 encryptor. MIT. */
#include <sys/types.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <wiredtiger.h>
#include <wiredtiger_ext.h>
#include "bsonlite_crypto.h"

typedef struct { WT_ENCRYPTOR iface; WT_EXTENSION_API *api; int customized; } BSL_ENCRYPTOR;
static int encrypt_cb(WT_ENCRYPTOR *raw, WT_SESSION *session, uint8_t *src,
    size_t length, uint8_t *dst, size_t capacity, size_t *written) {
    (void)session;
    if (!((BSL_ENCRYPTOR *)raw)->customized) return EACCES;
    return bsonlite_encrypt(BSL_WIREDTIGER_DOMAIN,src,length,dst,capacity,written);
}
static int decrypt_cb(WT_ENCRYPTOR *raw, WT_SESSION *session, uint8_t *src,
    size_t length, uint8_t *dst, size_t capacity, size_t *written) {
    (void)session;
    if (!((BSL_ENCRYPTOR *)raw)->customized) return EACCES;
    return bsonlite_decrypt(BSL_WIREDTIGER_DOMAIN,src,length,dst,capacity,written);
}
static int size_cb(WT_ENCRYPTOR *raw, WT_SESSION *session, size_t *extra) {
    (void)raw; (void)session; *extra = BSL_OVERHEAD; return 0;
}
static int terminate_cb(WT_ENCRYPTOR *raw, WT_SESSION *session) {
    (void)session; memset(raw,0,sizeof(BSL_ENCRYPTOR)); free(raw); return 0;
}
static int customize_cb(WT_ENCRYPTOR *raw, WT_SESSION *session, WT_CONFIG_ARG *config,
    WT_ENCRYPTOR **result) {
    BSL_ENCRYPTOR *base=(BSL_ENCRYPTOR *)raw, *custom; WT_CONFIG_ITEM id; int ret;
    *result=NULL;
    ret=base->api->config_get(base->api,session,config,"keyid",&id);
    if (ret != 0 || bsonlite_load_key() != 0 || !bsonlite_key_matches(id.str,id.len)) return EACCES;
    custom=(BSL_ENCRYPTOR *)calloc(1,sizeof(*custom)); if (custom == NULL) return ENOMEM;
    *custom=*base; custom->customized=1; *result=&custom->iface; return 0;
}
int bsonlite_wiredtiger_init(WT_CONNECTION *connection, WT_CONFIG_ARG *config) {
    BSL_ENCRYPTOR *base; int ret; (void)config;
    base=(BSL_ENCRYPTOR *)calloc(1,sizeof(*base)); if (base == NULL) return ENOMEM;
    base->api=connection->get_extension_api(connection);
    base->iface.encrypt=encrypt_cb; base->iface.decrypt=decrypt_cb;
    base->iface.sizing=size_cb; base->iface.customize=customize_cb; base->iface.terminate=terminate_cb;
    ret=connection->add_encryptor(connection,BSL_CIPHER_NAME,&base->iface,NULL);
    if (ret != 0) free(base);
    return ret;
}
#ifndef BSONLITE_STATIC
#ifdef _WIN32
__declspec(dllexport)
#endif
int wiredtiger_extension_init(WT_CONNECTION *connection, WT_CONFIG_ARG *config) {
    return bsonlite_wiredtiger_init(connection,config);
}
#endif
