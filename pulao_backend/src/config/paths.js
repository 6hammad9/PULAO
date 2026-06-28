import path from "path";
import dotenv from "dotenv";

dotenv.config();

const normalizePath = (value) => path.resolve(String(value).replace(/[\\/]+$/, ""));
const requiredPath = (name, fallbackName = name) => {
  const value = process.env[name] || process.env[fallbackName];
  if (!value) {
    throw new Error(`${name} is not configured. Add it to emacs_backend/.env.`);
  }
  return normalizePath(value);
};

export const OCR_ROOT = requiredPath("OCR_ROOT", "OCR_BASE_DIR");
export const OCR_EVENTS_DIR = normalizePath(process.env.OCR_EVENTS_DIR || path.join(OCR_ROOT, "events"));
export const OCR_DETECTED_DIR = normalizePath(process.env.OCR_DETECTED_DIR || path.join(OCR_ROOT, "detected"));
export const OCR_WHITELIST_DIR = normalizePath(process.env.OCR_WHITELIST_DIR || path.join(OCR_ROOT, "whitelisted"));
export const OCR_METADATA_PATH = normalizePath(process.env.OCR_METADATA_PATH || path.join(OCR_ROOT, "metadata.json"));
export const OCR_USERS_PKL_PATH = normalizePath(process.env.OCR_USERS_PKL_PATH || path.join(OCR_ROOT, "users.pkl"));
export const PYTHON_UPDATE_SCRIPT = normalizePath(process.env.PYTHON_UPDATE_SCRIPT || path.join(OCR_ROOT, "update_embedding.py"));
export const PYTHON_MANAGE_SCRIPT = normalizePath(process.env.PYTHON_MANAGE_SCRIPT || path.join(OCR_ROOT, "manage_embeddings.py"));

export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
export const VISION_PUBLIC_BASE_URL = (process.env.VISION_PUBLIC_BASE_URL || "http://localhost:6033").replace(/\/+$/, "");

export const detectedCategoryDir = (category) => path.join(OCR_DETECTED_DIR, category);

export const ocrEventRoot = (eventId) => path.join(OCR_EVENTS_DIR, String(eventId));
