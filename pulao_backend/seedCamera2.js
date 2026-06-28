// One-off script: register the public MJPEG test camera (cam_id "2") in MongoDB
// so it shows up in the dashboard. Safe to re-run (upsert by cam_id).
import dotenv from "dotenv";
import mongoose from "mongoose";
import CameraInfo from "./src/models/CameraInfo.js";

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const doc = {
    cam_id: "2",
    channel: 2,
    camera_name: "Public MJPEG test camera",
    color: "#22c55e",
    stream_source: "http://158.58.130.148/mjpg/video.mjpg",
    stream_type: "http",
    stream_port: 6033,
    stream_username: "",
    stream_password: "",
    enabled: true,
  };

  const result = await CameraInfo.findOneAndUpdate(
    { cam_id: "2" },
    { $set: doc },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log("Upserted camera:", {
    _id: result._id.toString(),
    cam_id: result.cam_id,
    camera_name: result.camera_name,
    stream_source: result.stream_source,
    stream_type: result.stream_type,
    enabled: result.enabled,
  });

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
