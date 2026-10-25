
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    cloudinaryPublicId: { type: String, required: true },
    fileUrl: { type: String, required: true },
    resourceType: { type: String, default: "raw" },
    format: String,
    size: Number,
    category: {
      type: String,
      enum: ["document", "application", "hall-ticket", "other"],
      default: "document",
    },
    ownerId: { type: String, required: true },
    personId: { type: String, default: "local-demo-user" },
    folderId: { type: String, default: null },
    documentDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Document", documentSchema);
