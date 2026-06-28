import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    venue: { type: String, trim: true, default: "" },
    starts_at: { type: Date, default: null },
    ends_at: { type: Date, default: null },
    status: {
      type: String,
      enum: ["draft", "scheduled", "live", "completed", "archived"],
      default: "draft",
    },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
  },
  { timestamps: true }
);

eventSchema.index({ status: 1, starts_at: 1 });
eventSchema.index({ name: "text", venue: "text", code: "text" });

export default mongoose.model("Event", eventSchema);
