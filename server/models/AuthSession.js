const mongoose = require("mongoose");

const authSessionSchema = new mongoose.Schema(
  {
    sessionTokenHash: { type: String, default: null, index: true },
    deviceTokenHash: { type: String, default: null, index: true },
    sessionExpiresAt: { type: Date, required: true },
    deviceExpiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuthSession", authSessionSchema);
