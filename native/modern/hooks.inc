// Included inside namespace mongo. BsonLite MIT additions to the SSPL engine.
namespace {
Status bsonliteTransform(ConstDataRange in, DataRange* out, bool encrypt, unsigned char domain) {
    if (!out) return Status(ErrorCodes::BadValue, "Missing BsonLite output buffer");
    size_t written = 0;
    const auto result = encrypt
        ? bsonlite_encrypt(domain, reinterpret_cast<const uint8_t*>(in.data()), in.length(),
                          reinterpret_cast<uint8_t*>(out->data()), out->length(), &written)
        : bsonlite_decrypt(domain, reinterpret_cast<const uint8_t*>(in.data()), in.length(),
                          reinterpret_cast<uint8_t*>(out->data()), out->length(), &written);
    if (result != 0)
        return Status(ErrorCodes::OperationFailed, "BsonLite protected data authentication failed");
    *out = DataRange(out->data(), written);
    return Status::OK();
}

class BsonLiteRemoveProtector final : public DataProtector {
public:
    Status protect(ConstDataRange in, DataRange* out) override {
        if (!out || out->length() < 4 || in.length() > UINT32_MAX - BSL_OVERHEAD)
            return Status(ErrorCodes::Overflow, "BsonLite protected buffer is too large");
        DataRange payload(out->data() + 4, out->length() - 4);
        auto result = bsonliteTransform(in, &payload, true, BSL_REMOVE_DOMAIN);
        if (!result.isOK()) return result;
        const auto length = payload.length();
        for (size_t i = 0; i < 4; ++i)
            out->data()[i] = static_cast<char>(length >> (8 * i));
        *out = DataRange(out->data(), length + 4);
        return Status::OK();
    }
    Status finalize(DataRange* out) override {
        return protect(ConstDataRange("", size_t{0}), out);
    }
    size_t getNumberOfBytesReservedForTag() const override { return 0; }
    Status finalizeTag(DataRange* out) override {
        if (!out) return Status(ErrorCodes::BadValue, "Missing BsonLite output buffer");
        *out = DataRange(out->data(), size_t{0});
        return Status::OK();
    }
};
}  // namespace
