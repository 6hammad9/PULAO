import express from "express";
import fs from "fs";
import path from "path";
import DetectedFrames from "../models/DetectedFrames.js";
import Event from "../models/Event.js";
import { OCR_EVENTS_DIR, detectedCategoryDir } from "../config/paths.js";

const router = express.Router();

const normalizeCategory = (entry) => {
  const status = entry.person?.status?.toLowerCase();
  const finding = String(entry.findings || "").toLowerCase();

  if (status === "notwhitelisted" || finding === "notwhitelisted") return "NotWhitelisted";
  if (status === "whitelisted" || finding === "whitelisted") return "Whitelisted";
  if (status === "unclear" || finding === "unclear") return "Unclear";
  return "Detected";
};

// Base folders
const folders = [
  {
    category: "Unclear",
    dir: detectedCategoryDir("unclear"),
    urlPrefix: "unclear",
  },
  {
    category: "Whitelisted",
    dir: detectedCategoryDir("whitelisted"),
    urlPrefix: "whitelisted",
  },
  {
    category: "NotWhitelisted",
    dir: detectedCategoryDir("notwhitelisted"),
    urlPrefix: "notwhitelisted",
  }
];

const imageFilePattern = /\.(jpg|jpeg|png|webp)$/i;
const categoryPrefixes = {
  Unclear: "unclear",
  Whitelisted: "whitelisted",
  NotWhitelisted: "notwhitelisted",
};

const getFileUrl = (category, filename) => {
  const prefix = categoryPrefixes[category] || "unclear";
  return `/${prefix}/${filename}`;
};

const legacyFoldersByPrefix = Object.fromEntries(
  folders.map((folder) => [folder.urlPrefix.toLowerCase(), folder.dir])
);

const readFolderImages = () => {
  const images = [];

  for (const folder of folders) {
    if (!fs.existsSync(folder.dir)) continue;

    const files = fs.readdirSync(folder.dir).filter(file =>
      imageFilePattern.test(file)
    );

    files.forEach(file => {
      const filePath = path.join(folder.dir, file);
      const stats = fs.statSync(filePath);
      images.push({
        category: folder.category,
        filename: file,
        url: `/${folder.urlPrefix}/${file}`,
        createdAt: stats.mtime,
        source: "file",
      });
    });
  }

  return images;
};

const normalizeDetectionUrl = (entry, category) => {
  const rawPath = entry.filepath || entry.full_frame_path || "";
  const filename = path.basename(rawPath || "detection.jpg");
  const eventId = entry.event ? String(entry.event) : "";

  if (!rawPath) return getFileUrl(category, filename);

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

    return `/ocr-events/${eventId}/detected/${categoryPrefixes[category] || storedPrefix}/${filename}`;
  }

  if (rawPath.startsWith("/")) {
    return rawPath.replace(/\\/g, "/");
  }

  return getFileUrl(category, filename);
};

router.get("/api/gallery-images", async (req, res) => {
  try {
    if (req.query.event_id) {
      const event = await Event.findById(req.query.event_id).select("name").lean();
      const detections = await DetectedFrames.find({ event: req.query.event_id })
        .populate("department", "dep_name")
        .populate("department_area", "area_name")
        .sort({ datetime: -1 });

      const dbImages = detections.map((entry) => {
        const category = normalizeCategory(entry);
        const filename = path.basename(entry.filepath || entry.full_frame_path || "detection.jpg");

        return {
          category,
          filename,
          url: normalizeDetectionUrl(entry, category),
          createdAt: entry.datetime,
          source: "db",
          // Who / where / when this detection happened, for the gallery cards.
          person: entry.person?.name || "Unknown",
          status: entry.person?.status || entry.findings || "",
          findings: entry.findings || "",
          camera: entry.cam || "",
          department: entry.department?.dep_name || "",
          section: entry.department_area?.area_name || "",
          datetime: entry.datetime,
        };
      });

      const allImagesByUrl = new Map();
      const imageSources = event?.name === "TEST EVENT"
        ? [...readFolderImages(), ...dbImages]
        : dbImages;

      imageSources.forEach((image) => {
        const key = image.url.toLowerCase();
        const existing = allImagesByUrl.get(key);

        // Prefer DB records (they carry person/camera/time) over bare files,
        // then prefer the most recent within the same source.
        const preferNew =
          !existing ||
          (image.source === "db" && existing.source !== "db") ||
          (image.source === existing.source &&
            new Date(image.createdAt) > new Date(existing.createdAt));

        if (preferNew) allImagesByUrl.set(key, image);
      });

      const allImages = Array.from(allImagesByUrl.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json(allImages);
    }

    const allImages = readFolderImages()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json(allImages);
  } catch (err) {
    console.error("Error reading gallery images:", err);
    res.status(500).json({ error: "Failed to fetch gallery images" });
  }
});

export default router;
