const mongoose = require("mongoose");

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    endTime: { type: String, required: true },
    type: {
      type: String,
      enum: ["exam", "deadline", "result", "other"],
      default: "other",
    },
    notes: { type: String, default: "" },
    personId: { type: String, default: "local-demo-user" },
    ownerId: { type: String, required: true, default: "local-demo-user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CalendarEvent", calendarEventSchema);
