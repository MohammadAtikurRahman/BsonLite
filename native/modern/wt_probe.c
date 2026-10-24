/* BsonLite integration probe for the actual pinned WiredTiger 12 C API. MIT. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wiredtiger.h>
#include "bsonlite_crypto.h"

int main(int argc, char **argv) {
    WT_CONNECTION *connection = NULL;
    WT_SESSION *session = NULL;
    WT_CURSOR *cursor = NULL;
    char config[512], key[32], value[4096];
    const char *actual;
    int ret = 0, result = 1, writing;
    if (argc != 4 || bsonlite_crypto_selftest() != 0) return 2;
    writing = strcmp(argv[2], "write") == 0;
    if (bsonlite_load_key() != 0) return 3;
    snprintf(config, sizeof(config),
        "%scache_size=64M,log=(enabled=true,remove=false),encryption=(name=%s,keyid=%s)",
        writing ? "create," : "", BSL_CIPHER_NAME, argv[3]);
    if (wiredtiger_open(argv[1], NULL, config, &connection) != 0) return 4;
    if (connection->open_session(connection, NULL, NULL, &session) != 0) goto done;
    if (writing && session->create(session, "table:records", "key_format=S,value_format=S") != 0) goto done;
    if (session->open_cursor(session, "table:records", NULL, NULL, &cursor) != 0) goto done;
    memset(value, 'x', sizeof(value) - 1);
    memcpy(value, "BSL_PRIVATE_WT12_SENTINEL", 25);
    value[sizeof(value) - 1] = '\0';
    for (unsigned i = 0; i < 2048; ++i) {
        snprintf(key, sizeof(key), "key-%08u", i);
        cursor->set_key(cursor, key);
        if (writing) {
            cursor->set_value(cursor, value);
            ret = cursor->insert(cursor);
        } else {
            ret = cursor->search(cursor);
            if (ret == 0) ret = cursor->get_value(cursor, &actual);
            if (ret == 0 && strcmp(actual, value) != 0) ret = 1;
        }
        if (ret != 0) goto done;
    }
    if (writing && session->checkpoint(session, NULL) != 0) goto done;
    result = 0;
done:
    if (cursor && cursor->close(cursor) != 0) result = 1;
    if (session && session->close(session, NULL) != 0) result = 1;
    if (connection && connection->close(connection, NULL) != 0) result = 1;
    return result;
}
