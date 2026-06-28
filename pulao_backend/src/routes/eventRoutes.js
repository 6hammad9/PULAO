import express from "express";
import Event from "../models/Event.js";
import PersonInfo from "../models/PersonInfo.js";
import CameraInfo from "../models/CameraInfo.js";
import Alert from "../models/Alert.js";
import DetectedFrames from "../models/DetectedFrames.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const events = await Event.find({ status: { $ne: "archived" } }).sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const event = await Event.create({
      name: req.body.name,
      code: req.body.code || "",
      description: req.body.description || "",
      venue: req.body.venue || "",
      starts_at: req.body.starts_at || null,
      ends_at: req.body.ends_at || null,
      status: req.body.status || "draft",
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/summary", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const eventQuery = { event: req.params.id };
    const [people, vip, blocked, cameras, alerts, review] = await Promise.all([
      PersonInfo.countDocuments(eventQuery),
      PersonInfo.countDocuments({ ...eventQuery, person_type: "vip" }),
      PersonInfo.countDocuments({ ...eventQuery, person_type: "banned" }),
      CameraInfo.countDocuments(eventQuery),
      Alert.countDocuments({ ...eventQuery, status: "new" }),
      DetectedFrames.countDocuments({ ...eventQuery, "person.status": "notwhitelisted" }),
    ]);

    res.json({ people, vip, blocked, cameras, alerts, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { status: "archived" },
      { new: true }
    );
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
