// Included inside namespace mongo by patch_mongo.py. BsonLite MIT implementation.
namespace {
class BsonLiteRemoveProtector final : public DataProtector {
public:
    Status protect(const uint8_t* in, size_t n, uint8_t* out, size_t capacity,
                   size_t* written) override {
        *written = 0;
        if (n > UINT32_MAX - BSL_OVERHEAD || capacity < 4) {
            return Status(ErrorCodes::Overflow, "BsonLite protected buffer is too large");
        }
        size_t result = 0;
        if (bsonlite_encrypt(BSL_REMOVE_DOMAIN, in, n, out + 4, capacity - 4, &result)) {
            return Status(ErrorCodes::OperationFailed, "BsonLite buffer encryption failed");
        }
        for (size_t i = 0; i < 4; ++i) out[i] = static_cast<uint8_t>(result >> (8 * i));
        *written = result + 4;
        return Status::OK();
    }
    Status finalize(uint8_t* out, size_t capacity, size_t* written) override {
        return protect(reinterpret_cast<const uint8_t*>(""), 0, out, capacity, written);
    }
    size_t getNumberOfBytesReservedForTag() const override { return 0; }
    Status finalizeTag(uint8_t*, size_t, size_t* written) override {
        *written = 0; return Status::OK();
    }
};
}  // namespace
