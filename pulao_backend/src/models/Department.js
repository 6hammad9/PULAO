import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema({
  dep_name: String,
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
  datetime: { type: Date, default: Date.now },
});

departmentSchema.index({ event: 1, dep_name: 1 });

export default mongoose.model("Department", departmentSchema);
