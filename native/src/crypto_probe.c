/* Developer self-test executable; not a customer dependency. */
#include "bsonlite_crypto.h"
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1],"--key-frame-test") == 0) {
        if (bsonlite_load_key() != 0) return 2;
        puts("{\"keyFrameAccepted\":true}"); return 0;
    }
    if (bsonlite_crypto_selftest() != 0) return 1;
    puts("{\"bsonliteNativeEncryption\":1,\"cipher\":\"xchacha20-poly1305\",\"selfTest\":true}");
    return 0;
}
