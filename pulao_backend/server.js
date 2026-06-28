import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url"; // Needed for __dirname in ES Modules
import galleryRoutes from "./src/routes/galleryRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import personRoutes from "./src/routes/personRoutes.js";
import cameraRoutes from "./src/routes/cameraRoutes.js";
import departmentRoutes from "./src/routes/departmentRoutes.js";
import detectedFramesRoutes from "./src/routes/detectedFramesRoutes.js";
import nonWhitelistedRoutes from "./src/routes/nonwhitelistedRoutes.js";
import whitelistedRoutes from "./src/routes/whitelistedRoutes.js";
import alertRoutes from "./src/routes/alertRoutes.js";
import eventRoutes from "./src/routes/eventRoutes.js";
import { CLIENT_ORIGIN, OCR_DETECTED_DIR, OCR_EVENTS_DIR, OCR_WHITELIST_DIR } from "./src/config/paths.js";
// Fix __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Serve static files from the uploads folder with additional headers

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res, filePath) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);
app.use("/uploads", express.static("uploads"));
// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI is not defined. Check your .env file.");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Routes
app.use("/api/users", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/register-person", personRoutes);
app.use("/api/cameras", cameraRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/nonwhitelisted", nonWhitelistedRoutes);
app.use("/api/alerts", alertRoutes);

app.use(galleryRoutes);

// Serve static folders
app.use('/whitelisted', express.static(path.join(OCR_DETECTED_DIR, 'whitelisted')));

// Serve unclear folder
app.use('/unclear', express.static(path.join(OCR_DETECTED_DIR, 'unclear')));

// Serve notwhitelisted folder
app.use('/notwhitelisted', express.static(path.join(OCR_DETECTED_DIR, 'notwhitelisted')));
app.use('/ocr-events', express.static(OCR_EVENTS_DIR));
// backend/server.js


// ... other code
app.use('/api/whitelisted', whitelistedRoutes);

app.use("/api/detectedframes", detectedFramesRoutes);
app.use('/whitelisted', express.static(OCR_WHITELIST_DIR));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
