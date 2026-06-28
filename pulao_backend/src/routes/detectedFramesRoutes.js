import express from "express";
import DetectedFrames from "../models/DetectedFrames.js";
import CameraInfo from "../models/CameraInfo.js";
import PersonInfo from "../models/PersonInfo.js";
import { evaluateDetectionForAlert } from "../services/alertService.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const {
      cam,
      track_id,
      filepath,
      full_frame_path,
      findings,
      confidence,
      person,
      seen,
      entered_at,
      exited_at,
      duration_seconds,
      event_status,
      event_id,
    } = req.body;

    // Ensure cam is a string
    const camId = cam.toString();

    const cameraQuery = { cam_id: camId };
    if (event_id) cameraQuery.event = event_id;

    let camInfo = await CameraInfo.findOne(cameraQuery)
      .populate("department")
      .populate("department_area");

    if (!event_id && !camInfo) {
      const matchingCameras = await CameraInfo.find({ cam_id: camId }).limit(2);
      if (matchingCameras.length > 1) {
        return res.status(409).json({
          error: `Camera ID ${camId} exists in more than one event. Send event_id with the detection.`,
        });
      }
    }

    if (!camInfo) {
      return res.status(404).json({ error: `Camera with ID ${camId} not found` });
    }

    const detectionEvent = event_id || camInfo.event || null;
    const resolvedPerson = { ...(person || {}) };
    let resolvedFindings = findings;

    if (detectionEvent && resolvedPerson.name && resolvedPerson.name !== "na") {
      const registeredPerson = await PersonInfo.findOne({
        event: detectionEvent,
        name: resolvedPerson.name,
      });

      if (!registeredPerson) {
        // Person isn't registered in this event at all -> not whitelisted.
        resolvedFindings = "notwhitelisted";
        resolvedPerson.status = "notwhitelisted";
      } else if (findings === "notwhitelisted") {
        // The vision service applies camera-scoped access: a registered person
        // can still be "notwhitelisted" on a camera they aren't authorized for.
        // Respect that decision instead of overriding it with their global status,
        // otherwise these never show up in the Access Review list.
        resolvedFindings = "notwhitelisted";
        resolvedPerson.status = "notwhitelisted";
        resolvedPerson.color = registeredPerson.color || resolvedPerson.color;
      } else {
        resolvedFindings = registeredPerson.status || "whitelisted";
        resolvedPerson.status = registeredPerson.status || "whitelisted";
        resolvedPerson.color = registeredPerson.color || resolvedPerson.color;
      }
    }

    const entryData = {
      cam: camId,
      track_id,
      filepath,
      full_frame_path,
      findings: resolvedFindings,
      confidence,
      person: resolvedPerson,
      seen,
      entered_at,
      exited_at,
      duration_seconds,
      event_status,
      department: camInfo.department?._id || null,
      department_area: camInfo.department_area?._id || null,
      event: detectionEvent,
    };

    if (event_status === "closed" && track_id !== undefined) {
      const openEntry = await DetectedFrames.findOne({
        cam: camId,
        track_id,
        event: detectionEvent,
        event_status: "open",
      }).sort({ entered_at: -1, datetime: -1 });

      if (openEntry) {
        openEntry.exited_at = exited_at || new Date();
        openEntry.duration_seconds = duration_seconds;
        openEntry.event_status = "closed";
        openEntry.confidence = confidence ?? openEntry.confidence;
        openEntry.findings = findings || openEntry.findings;
        openEntry.person = person || openEntry.person;
        await openEntry.save();
        return res.status(200).json({ message: "Detection event closed successfully" });
      }
    }

    const newEntry = new DetectedFrames(entryData);

    await newEntry.save();

    // Fire-and-forget: evaluate this detection against alert rules. Never let
    // alerting slow down or break detection ingestion.
    evaluateDetectionForAlert(newEntry, { camera_name: camInfo.camera_name }).catch(() => {});

    res.status(201).json({ message: "Detection saved successfully" });
  } catch (error) {
    console.error("Failed to save detection:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
