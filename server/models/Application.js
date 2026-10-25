
const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["Application", "Hall Ticket"],
      default: "Application",
    },
    examDate: { type: String, default: "" },
    deadline: { type: String, default: "" },
    resultDate: { type: String, default: "" },
    notes: { type: String, default: "" },

    ownerId: { type: String, required: true, default: "local-demo-user" },
    personId: { type: String, default: "local-demo-user" },

    cloudinaryPublicId: { type: String, default: "" },
    fileUrl: { type: String, default: "" },
    resourceType: { type: String, default: "" },
    fileName: { type: String, default: "" },
    format: { type: String, default: "" },
    size: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Application", applicationSchema);
