// models/PersonInfo.js
import mongoose from "mongoose";

const personInfoSchema = new mongoose.Schema({
  name: String,
  // Legacy single-camera link. Kept for backward compatibility; new logic uses
  // allowed_cameras. Mirrors allowed_cameras[0] when a person is saved.
  cam_id: { type: mongoose.Schema.Types.ObjectId, ref: "CameraInfo" },
  // A person can be whitelisted on multiple cameras/checkpoints.
  allowed_cameras: [{ type: mongoose.Schema.Types.ObjectId, ref: "CameraInfo" }],
  status: String,
  color: String,
  read_status: Number,
  datetime: { type: Date, default: Date.now },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
  image: { type: String },
  // Phase 1: classification that drives alerting. "banned" = watchlist.
  person_type: {
    type: String,
    enum: ["employee", "visitor", "contractor", "vip", "banned"],
    default: "employee",
  },
  // Multi-tenancy placeholder for the future SaaS pass.
  organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
});

personInfoSchema.index({ event: 1, person_type: 1 });
personInfoSchema.index({ event: 1, status: 1 });

export default mongoose.model("PersonInfo", personInfoSchema);
