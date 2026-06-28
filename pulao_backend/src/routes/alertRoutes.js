import express from "express";
import Alert from "../models/Alert.js";

const router = express.Router();

const eventFilter = (req) => (req.query.event_id ? { event: req.query.event_id } : {});

// GET /api/alerts?status=new&severity=critical&limit=50
router.get("/", async (req, res) => {
  try {
    const { status, severity, limit = 50 } = req.query;
    const query = eventFilter(req);
    if (status) query.status = status;
    if (severity) query.severity = severity;

    const alerts = await Alert.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .populate("department")
      .populate("department_area");

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/count -> unacknowledged ("new") count for the bell badge
router.get("/count", async (req, res) => {
  try {
    const count = await Alert.countDocuments({ ...eventFilter(req), status: "new" });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/acknowledge
router.patch("/:id/acknowledge", async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      {
        status: "acknowledged",
        acknowledged_at: new Date(),
        acknowledged_by: req.body?.user_id || null,
      },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/resolve
router.patch("/:id/resolve", async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { status: "resolved" },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/acknowledge-all -> clear the bell
router.post("/acknowledge-all", async (req, res) => {
  try {
    const result = await Alert.updateMany(
      { ...eventFilter(req), status: "new" },
      { status: "acknowledged", acknowledged_at: new Date() }
    );
    res.json({ acknowledged: result.modifiedCount ?? result.nModified ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
