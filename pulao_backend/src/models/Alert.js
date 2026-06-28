import mongoose from "mongoose";

// Phase 1 SaaS feature: an Alert is created when a detection event matches a
// rule (banned/watchlisted person, unauthorized presence, etc.). The frontend
// polls these for the notification bell; webhooks/email dispatch on top.
const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["banned_person", "unauthorized", "unknown_person", "custom"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "warning",
    },
    title: { type: String, required: true },
    message: { type: String, default: "" },

    // Where / who
    cam: { type: String },
    camera_name: { type: String, default: "" },
    person_name: { type: String, default: "" },
    person_type: { type: String, default: "" },
    confidence: { type: Number, default: 0 },
    findings: { type: String, default: "" },

    detection: { type: mongoose.Schema.Types.ObjectId, ref: "DetectedFrames", default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    department_area: { type: mongoose.Schema.Types.ObjectId, ref: "DepartmentArea", default: null },

    // Workflow
    status: {
      type: String,
      enum: ["new", "acknowledged", "resolved"],
      default: "new",
    },
    acknowledged_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acknowledged_at: { type: Date, default: null },

    // Multi-tenancy placeholder for the future SaaS pass.
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
  },
  { timestamps: true }
);

// Fast unacknowledged-list queries and cooldown lookups.
alertSchema.index({ status: 1, createdAt: -1 });
alertSchema.index({ cam: 1, person_name: 1, type: 1, createdAt: -1 });
alertSchema.index({ event: 1, status: 1, createdAt: -1 });

export default mongoose.model("Alert", alertSchema);
