import express from "express";
import fs from "fs";
import path from "path";
import DetectedFrames from "../models/DetectedFrames.js";
import Department from "../models/Department.js";
import DepartmentArea from "../models/DepartmentArea.js";
import PersonInfo from "../models/PersonInfo.js";
import { OCR_EVENTS_DIR, detectedCategoryDir } from "../config/paths.js";

const router = express.Router();

const eventFilter = (req) => (req.query.event_id ? { event: req.query.event_id } : {});

const categoryPrefixes = {
  NotWhitelisted: "notwhitelisted",
  Whitelisted: "whitelisted",
  Unclear: "unclear",
};

const legacyFoldersByPrefix = {
  unclear: detectedCategoryDir("unclear"),
  whitelisted: detectedCategoryDir("whitelisted"),
  notwhitelisted: detectedCategoryDir("notwhitelisted"),
};

const normalizeDetectionUrl = (entry, category = "NotWhitelisted") => {
  const rawPath = entry.filepath || entry.full_frame_path || "";
  const filename = path.basename(rawPath || "detection.jpg");
  const eventId = entry.event ? String(entry.event) : "";
  const prefix = categoryPrefixes[category] || "notwhitelisted";

  if (!rawPath) return `/${prefix}/${filename}`;

  if (rawPath.startsWith("events/")) {
    return `/ocr-events/${rawPath.slice("events/".length).replace(/\\/g, "/")}`;
  }

  if (eventId && /^(unclear|whitelisted|notwhitelisted)[\\/]/i.test(rawPath)) {
    const normalizedPath = rawPath.replace(/\\/g, "/");
    const eventFile = path.join(OCR_EVENTS_DIR, eventId, "detected", normalizedPath);
    if (fs.existsSync(eventFile)) {
      return `/ocr-events/${eventId}/detected/${normalizedPath}`;
    }

    const [storedPrefix] = normalizedPath.split("/");
    const legacyDir = legacyFoldersByPrefix[storedPrefix.toLowerCase()];
    if (legacyDir && fs.existsSync(path.join(legacyDir, filename))) {
      return `/${storedPrefix}/${filename}`;
    }

    return `/ocr-events/${eventId}/detected/${prefix}/${filename}`;
  }

  if (rawPath.startsWith("/")) {
    return rawPath.replace(/\\/g, "/");
  }

  return `/${prefix}/${filename}`;
};

router.get("/count", async (req, res) => {
  try {
    // Counts all documents where the person status is 'notwhitelisted'
    const count = await DetectedFrames.countDocuments({ 
      ...eventFilter(req),
      "person.status": "notwhitelisted" 
    });
    
    res.status(200).json({ count });
  } catch (err) {
    console.error("❌ Failed to fetch non-whitelisted count:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const results = await DetectedFrames.find({ ...eventFilter(req), "person.status": "notwhitelisted" })
      .populate("department", "dep_name") // 👈 populate just the dep_name field
      .populate("department_area", "area_name") // 👈 populate just the area_name
      .sort({ datetime: -1 });

    // Look up the allowed checkpoints for any registered people in these results,
    // so the operator can see where each person IS allowed vs where they were flagged.
    const names = [...new Set(results.map((r) => r.person?.name).filter(Boolean))];
    const personQuery = { name: { $in: names } };
    if (req.query.event_id) personQuery.event = req.query.event_id;
    const people = await PersonInfo.find(personQuery).populate("allowed_cameras", "cam_id camera_name");

    const allowedByName = new Map();
    for (const p of people) {
      const list = (p.allowed_cameras || [])
        .filter(Boolean)
        .map((c) => `${c.camera_name} (${c.cam_id})`);
      allowedByName.set(p.name, list);
    }

    const formatted = results.map((entry) => {
      const allowed = allowedByName.get(entry.person?.name);
      return {
        _id: entry._id,
        name: entry.person?.name || "Unknown",
        image: entry.filepath,
        image_url: normalizeDetectionUrl(entry),
        camera: entry.cam || "Unknown Camera",
        department: entry.department?.dep_name || "Unknown Department",
        section: entry.department_area?.area_name || "", // optional
        findings: entry.findings,
        date: entry.datetime,
        time: entry.datetime,
        // Where this person is whitelisted. Empty array => registered but no
        // cameras; undefined => not a registered person at all.
        allowed_checkpoints: allowed ? allowed.join(", ") : "",
        registered: allowed !== undefined,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Failed to fetch non-whitelisted data:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
