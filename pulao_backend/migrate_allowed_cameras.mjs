// One-off migration: backfill allowed_cameras for existing people.
// allowed_cameras = cam_id ? [cam_id] : []   (only for records missing it)
import mongoose from "mongoose";
import dotenv from "dotenv";
import PersonInfo from "./src/models/PersonInfo.js";

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log("Connected.");

const people = await PersonInfo.find({
  $or: [{ allowed_cameras: { $exists: false } }, { allowed_cameras: { $size: 0 } }],
});

console.log(`Found ${people.length} person(s) needing migration.`);

let updated = 0;
for (const p of people) {
  p.allowed_cameras = p.cam_id ? [p.cam_id] : [];
  await p.save();
  updated += 1;
  console.log(`  ✓ ${p.name}: allowed_cameras = [${p.allowed_cameras.join(", ")}]`);
}

console.log(`Done. Migrated ${updated} record(s).`);
await mongoose.disconnect();
