const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    personId: { type: String, required: true },
    ownerId: { type: String, required: true, default: "local-demo-user" },
    parentId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Folder", folderSchema);
