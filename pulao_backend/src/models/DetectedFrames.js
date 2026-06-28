import mongoose from "mongoose";

const detectedFramesSchema = new mongoose.Schema({
  cam: String,
  track_id: Number,
  filepath: String,
  full_frame_path: String,
  findings: String,
  confidence: Number,
  person: {
    name: String,
    status: String,
    color: String,
  },
  seen: Number,
  entered_at: Date,
  exited_at: Date,
  duration_seconds: Number,
  event_status: {
    type: String,
    enum: ["open", "closed", "snapshot"],
    default: "snapshot",
  },
  datetime: { type: Date, default: Date.now },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
  department_area: { type: mongoose.Schema.Types.ObjectId, ref: "DepartmentArea" },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
});

detectedFramesSchema.index({ event: 1, datetime: -1 });
detectedFramesSchema.index({ event: 1, "person.status": 1, datetime: -1 });

export default mongoose.model("DetectedFrames", detectedFramesSchema);
