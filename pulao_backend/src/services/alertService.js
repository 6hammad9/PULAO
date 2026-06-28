import Alert from "../models/Alert.js";
import PersonInfo from "../models/PersonInfo.js";

// Tunables (env-overridable).
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 60000);
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_ON_UNKNOWN = process.env.ALERT_ON_UNKNOWN === "1";

const isRealName = (name) => {
  const n = (name || "").trim().toLowerCase();
  return n && n !== "na" && n !== "unknown";
};

// Decide what alert (if any) a detection event warrants.
// This is the seed of the Phase 1 "rules engine"; for now the rules are fixed.
async function classifyDetection(detection) {
  const name = detection?.person?.name?.trim() || "";
  const findings = (detection.findings || "").toLowerCase();

  // 1. Recognized + banned/watchlisted -> critical.
  if (isRealName(name)) {
    const personQuery = { name };
    if (detection.event) personQuery.event = detection.event;
    const person = await PersonInfo.findOne(personQuery);
    if (person?.person_type === "banned") {
      return {
        type: "banned_person",
        severity: "critical",
        title: `Banned person detected: ${name}`,
        person_type: "banned",
      };
    }
  }

  // 2. Unauthorized: recognized/seen but not whitelisted on this camera.
  if (findings === "notwhitelisted") {
    return {
      type: "unauthorized",
      severity: "warning",
      title: isRealName(name)
        ? `Unauthorized: ${name} on a restricted camera`
        : "Unauthorized person detected",
      person_type: "",
    };
  }

  // 3. Unknown face (off by default — noisy).
  if (ALERT_ON_UNKNOWN && (findings === "unclear" || !isRealName(name))) {
    return {
      type: "unknown_person",
      severity: "info",
      title: "Unknown person detected",
      person_type: "",
    };
  }

  return null;
}

// Avoid one alert per frame: suppress duplicates for the same
// person/camera/type within the cooldown window.
async function withinCooldown(filter) {
  const since = new Date(Date.now() - ALERT_COOLDOWN_MS);
  const existing = await Alert.findOne({ ...filter, createdAt: { $gte: since } })
    .select("_id")
    .lean();
  return Boolean(existing);
}

async function dispatchWebhook(alert) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        person_name: alert.person_name,
        cam: alert.cam,
        camera_name: alert.camera_name,
        confidence: alert.confidence,
        createdAt: alert.createdAt,
      }),
    });
  } catch (err) {
    console.warn("⚠️ Alert webhook failed:", err.message);
  }
}

// Evaluate a saved detection and create an alert if warranted.
// Designed to be called fire-and-forget; never throws.
export async function evaluateDetectionForAlert(detection, context = {}) {
  try {
    const decision = await classifyDetection(detection);
    if (!decision) return null;

    const name = detection?.person?.name || "";
    const cooldownFilter = {
      cam: detection.cam,
      person_name: name,
      type: decision.type,
      event: detection.event || null,
    };
    if (await withinCooldown(cooldownFilter)) {
      return null;
    }

    const alert = await Alert.create({
      ...decision,
      message: decision.message || decision.title,
      cam: detection.cam,
      camera_name: context.camera_name || "",
      person_name: name,
      confidence: detection.confidence || 0,
      findings: detection.findings || "",
      detection: detection._id || null,
      department: detection.department || null,
      department_area: detection.department_area || null,
      event: detection.event || null,
    });

    console.log(`🚨 ALERT [${alert.severity}] ${alert.title} (cam ${alert.cam})`);
    dispatchWebhook(alert); // fire-and-forget
    return alert;
  } catch (err) {
    console.error("❌ Alert evaluation failed:", err.message);
    return null;
  }
}
