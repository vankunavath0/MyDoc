const mongoose = require("mongoose");

const personSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, default: "local-demo-user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Person", personSchema);
