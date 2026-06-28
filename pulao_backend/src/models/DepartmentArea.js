import mongoose from "mongoose";

const departmentAreaSchema = new mongoose.Schema({
  area_name: { type: String, required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
  datetime: { type: Date, default: Date.now },
});

departmentAreaSchema.index({ event: 1, department: 1, area_name: 1 });

export default mongoose.model("DepartmentArea", departmentAreaSchema);
