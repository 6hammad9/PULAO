import express from "express";
import multer from "multer";
import {
  registerPerson,
  getAllPersons,
  updatePerson,
  deletePerson,
  getPersonWithPictures,
  getAllPersonsWithPictures,
  registerFromLog,
  getWhitelistedPersons,
} from "../controllers/personController.js";

const router = express.Router();

// Configure multer to store files temporarily
const upload = multer({ dest: "temp_uploads/" });

// Routes
router.post("/", upload.single("image"), registerPerson);
router.get("/", getAllPersons);
router.post('/register-from-log/:id', registerFromLog);
router.get('/whitelisted', getWhitelistedPersons);
router.get("/with-pictures", getAllPersonsWithPictures);
router.put("/:id", upload.single("image"), updatePerson);
router.delete("/:id", deletePerson);
router.get("/:id", getPersonWithPictures);

export default router;
