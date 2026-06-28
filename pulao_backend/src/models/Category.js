import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  findings: String,
  color: String,
});

export default mongoose.model("Category", categorySchema);
