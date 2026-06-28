import multer from "multer";
import path from "path";
import fs from "fs"; // ✅ Import fs
import { fileURLToPath } from "url";

// ✅ Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadPath = path.join(__dirname, "../uploads");

// Ensure the uploads directory exists
fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath); // Always store in the main 'uploads' directory
  },
  filename: (req, file, cb) => {
    const personName = req.body.name; // Extract name from request body
    if (!personName) {
      return cb(new Error("Person name is required"), null);
    }
    cb(null, `${personName}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

export default upload;
