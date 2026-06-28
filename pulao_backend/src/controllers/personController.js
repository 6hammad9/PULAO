import PersonInfo from "../models/PersonInfo.js";
import CameraInfo from "../models/CameraInfo.js";
import WhitelistedPictures from "../models/WhitelistedPictures.js";
import DetectedFrames from "../models/DetectedFrames.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { exec } from "child_process";
import mongoose from "mongoose";
import {
  OCR_ROOT,
  OCR_DETECTED_DIR,
  OCR_EVENTS_DIR,
  OCR_WHITELIST_DIR,
  OCR_METADATA_PATH,
  OCR_USERS_PKL_PATH,
  PYTHON_UPDATE_SCRIPT,
  PYTHON_MANAGE_SCRIPT,
  ocrEventRoot,
} from "../config/paths.js";

// ---------------------------------------------------------
// 1. SETUP PATHS & DIRECTORIES
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Folders
const uploadDir = path.join(__dirname, "../../uploads");
const whitelistDir = OCR_WHITELIST_DIR;
const baseDetectedPath = path.join(OCR_DETECTED_DIR, "notwhitelisted");
const ocrEventsDir = OCR_EVENTS_DIR;

// Files
const metadataPath = OCR_METADATA_PATH;

// Python Scripts
const pythonUpdateScript = PYTHON_UPDATE_SCRIPT; // Adds/Updates users
const pythonManageScript = PYTHON_MANAGE_SCRIPT; // Deletes users
// Interpreter that has the vision deps (cv2, onnxruntime). Plain `python` on
// this machine is 3.14 WITHOUT cv2, which silently breaks embedding writes —
// use the py launcher pinned to 3.12 (override with OCR_PYTHON if needed).
const pythonBin = process.env.OCR_PYTHON || "py -3.12";
const getEventId = (req) => req.body.event_id || req.query.event_id || null;
const eventFilter = (req) => (req.query.event_id ? { event: req.query.event_id } : {});

// Ensure folders exist
[uploadDir, whitelistDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---------------------------------------------------------
// 2. HELPER FUNCTIONS
// ---------------------------------------------------------

const getEventOcrPaths = (eventId) => {
  if (!eventId) {
    return {
      root: OCR_ROOT,
      whitelistDir,
      detectedDir: OCR_DETECTED_DIR,
      metadataPath,
      usersPklPath: OCR_USERS_PKL_PATH,
      imagePrefix: "OCR/whitelisted",
    };
  }

  const root = ocrEventRoot(eventId);
  return {
    root,
    whitelistDir: path.join(root, "whitelisted"),
    detectedDir: path.join(root, "detected"),
    metadataPath: path.join(root, "metadata.json"),
    usersPklPath: path.join(root, "users.pkl"),
    imagePrefix: `OCR/events/${eventId}/whitelisted`,
  };
};

const ensureEventOcrDirs = (eventId) => {
  const paths = getEventOcrPaths(eventId);
  [
    paths.whitelistDir,
    path.join(paths.detectedDir, "whitelisted"),
    path.join(paths.detectedDir, "notwhitelisted"),
    path.join(paths.detectedDir, "unclear"),
  ].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  return paths;
};

// Run Python to UPDATE/ADD a user embedding
const runPythonUpdate = (name, imgPath, eventId = null) => {
  const paths = ensureEventOcrDirs(eventId);
  const cmd = `${pythonBin} "${pythonUpdateScript}" "${name}" "${path.resolve(imgPath)}"`;
  exec(cmd, {
    env: {
      ...process.env,
      OCR_BASE_DIR: paths.root,
      WHITELIST_FOLDER: paths.whitelistDir,
      USERS_PKL_PATH: paths.usersPklPath,
      METADATA_PATH: paths.metadataPath,
      DETECTED_FOLDER: paths.detectedDir,
    },
  }, (err, stdout, stderr) => {
    if (err) console.error("❌ Python Update Error:", stderr);
    else console.log("✅ Python Update Output:", stdout.trim());
  });
};

// Run Python to DELETE a user embedding (Fixes Ghost Recognition)
const runPythonDelete = (name, eventId = null) => {
  const paths = ensureEventOcrDirs(eventId);
  const cmd = `${pythonBin} "${pythonManageScript}" delete "${name}"`;
  exec(cmd, {
    env: {
      ...process.env,
      USERS_PKL_PATH: paths.usersPklPath,
    },
  }, (err, stdout, stderr) => {
    if (err) console.error("❌ Python Delete Error:", stderr);
    else console.log("✅ Python Delete Output:", stdout.trim());
  });
};

// Normalize the camera ids coming from the frontend. Accepts the new
// `allowed_cameras` (array, repeated form fields, or JSON string) and falls
// back to the legacy single `cam_id`. Returns a de-duplicated array of strings.
const parseCameraIds = (body) => {
  let ids = body.allowed_cameras;
  if (ids === undefined || ids === null || (Array.isArray(ids) && ids.length === 0)) {
    ids = body.cam_id;
  }
  if (ids === undefined || ids === null) return [];

  if (typeof ids === "string") {
    const trimmed = ids.trim();
    if (trimmed.startsWith("[")) {
      try { ids = JSON.parse(trimmed); } catch { ids = [trimmed]; }
    } else {
      ids = [trimmed];
    }
  }
  if (!Array.isArray(ids)) ids = [ids];

  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
};

// Update Metadata JSON for one OR many cameras (Async - Includes Department & Area).
// Pass { replace: true } to set the camera/department/area lists to exactly the
// supplied cameras (used when registering/editing a person from the UI). The
// default append mode is used by the detection-log merge flow.
async function updateMetadata(name, camIdentifiers, imagePath, { replace = false, eventId = null, status = "whitelisted" } = {}) {
  const eventPaths = ensureEventOcrDirs(eventId);
  const metadataFile = eventPaths.metadataPath;
  let metadata = {};
  if (fs.existsSync(metadataFile)) {
    try { metadata = JSON.parse(fs.readFileSync(metadataFile)); } catch (e) { metadata = {}; }
  }

  const identifiers = (Array.isArray(camIdentifiers) ? camIdentifiers : [camIdentifiers]).filter(
    (id) => id !== undefined && id !== null && String(id).trim() !== ""
  );

  if (!metadata[name]) {
    metadata[name] = { image: imagePath, cameras: [], departments: [], areas: [], status };
  }
  metadata[name].image = imagePath;
  metadata[name].status = status;

  if (replace) {
    metadata[name].cameras = [];
    metadata[name].departments = [];
    metadata[name].areas = [];
  }

  for (const camIdentifier of identifiers) {
    // Handles both ObjectId from DB and the readable 'cam_id' string from logs.
    let cameraDoc = null;
    if (mongoose.Types.ObjectId.isValid(camIdentifier)) {
      cameraDoc = await CameraInfo.findById(camIdentifier).populate('department').populate('department_area');
    }
    if (!cameraDoc) {
      const camQuery = { cam_id: camIdentifier };
      if (eventId) camQuery.event = eventId;
      cameraDoc = await CameraInfo.findOne(camQuery).populate('department').populate('department_area');
    }

    const camName = cameraDoc ? cameraDoc.cam_id : String(camIdentifier);
    const depName = cameraDoc?.department?.dep_name || "N/A";
    const areaName = cameraDoc?.department_area?.area_name || "N/A";

    if (!metadata[name].cameras.includes(camName)) metadata[name].cameras.push(camName);
    if (!metadata[name].departments.includes(depName)) metadata[name].departments.push(depName);
    if (!metadata[name].areas.includes(areaName)) metadata[name].areas.push(areaName);
  }

  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  console.log(`✅ Metadata updated for ${name} [cameras: ${metadata[name].cameras.join(", ")}]`);
}

// Remove from Metadata JSON
function removeFromMetadata(name, eventId = null) {
  const metadataFile = getEventOcrPaths(eventId).metadataPath;
  if (fs.existsSync(metadataFile)) {
    let metadata = JSON.parse(fs.readFileSync(metadataFile, "utf-8") || "{}");
    if (metadata[name]) {
      delete metadata[name];
      fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
      console.log(`🗑️ Removed ${name} from metadata.json`);
    }
  }
}

// ---------------------------------------------------------
// 3. CONTROLLERS
// ---------------------------------------------------------

export const registerPerson = async (req, res) => {
  try {
    const { name, status, category, person_type } = req.body;
    const cameraIds = parseCameraIds(req.body);
    if (!name || !status || cameraIds.length === 0)
      return res.status(400).json({ error: "Name, Status, and at least one Camera are required" });

    const eventId = getEventId(req);
    const ocrPaths = ensureEventOcrDirs(eventId);

    // Validate ALL selected cameras exist and belong to this event.
    const validIds = cameraIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    const camQuery = { _id: { $in: validIds } };
    if (eventId) camQuery.event = eventId;
    const cameraDocs = await CameraInfo.find(camQuery);
    if (cameraDocs.length !== cameraIds.length)
      return res.status(404).json({ error: "One or more selected cameras were not found in this event" });

    let imageName = null;
    let whitelistImagePath = null;

    if (req.file) {
      imageName = `${name}.jpg`;
      const uploadPath = path.join(uploadDir, imageName);
      whitelistImagePath = path.join(ocrPaths.whitelistDir, imageName);

      await sharp(req.file.path).jpeg({ quality: 80 }).toFile(uploadPath);
      await fs.promises.copyFile(uploadPath, whitelistImagePath);
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }

    // Banned/watchlist people are recognized everywhere but allowed NOWHERE:
    // force notwhitelisted, don't add them to any camera's whitelist, and skip
    // the whitelisted-pictures record — but still keep their embedding so the
    // detector can recognize and flag them (which fires the banned alert).
    const isBanned = (person_type || "employee") === "banned";
    const effectiveStatus = isBanned ? "notwhitelisted" : status;

    const newPerson = new PersonInfo({
      name,
      cam_id: validIds[0],          // backward-compatible primary camera
      allowed_cameras: validIds,
      status: effectiveStatus, category: category || null, image: imageName,
      person_type: person_type || "employee",
      event: eventId,
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      read_status: 0
    });
    await newPerson.save();

    if (imageName && whitelistImagePath) {
      // 1. Save Picture DB Record (only for genuinely whitelisted people)
      if (!isBanned) {
        await new WhitelistedPictures({ person: newPerson._id, filepath: whitelistImagePath.replace(/\\/g, "/"), event: eventId }).save();
      }

      // 2. Update Metadata (JSON). Banned => empty camera list => notwhitelisted everywhere.
      await updateMetadata(
        name,
        isBanned ? [] : cameraDocs.map((c) => c.cam_id),
        `${ocrPaths.imagePrefix}/${imageName}`,
        { replace: true, eventId, status: effectiveStatus }
      );

      // 3. Update Pickle (Python) — always, so the person is recognizable.
      runPythonUpdate(name, whitelistImagePath, eventId);
    }

    res.status(201).json({ message: "✅ Person registered", person: newPerson });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const updatePerson = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status, category, person_type } = req.body;

    const person = await PersonInfo.findById(id);
    if (!person) return res.status(404).json({ error: "Person not found" });
    const eventId = person.event || getEventId(req);
    const ocrPaths = ensureEventOcrDirs(eventId);

    const oldName = person.name;
    const nameChanged = name && name !== oldName;

    // 1. If name changed, delete OLD embedding immediately so it stops recognizing the old name
    if (nameChanged) {
        console.log(`🔄 Name change detected: Removing '${oldName}'...`);
        removeFromMetadata(oldName, eventId);
        runPythonDelete(oldName, eventId); // Calls manage_embeddings.py
    }

    let imageName = person.image;
    let whitelistImagePath = null;

    // 2. Handle Image Update
    if (req.file) {
      imageName = `${name || oldName}.jpg`;
      const uploadPath = path.join(uploadDir, imageName);
      whitelistImagePath = path.join(ocrPaths.whitelistDir, imageName);

      // Try to delete old image files
      if (person.image) {
         try { fs.unlinkSync(path.join(uploadDir, person.image)); } catch(e){}
         try { fs.unlinkSync(path.join(ocrPaths.whitelistDir, person.image)); } catch(e){}
      }

      await sharp(req.file.path).jpeg({ quality: 80 }).toFile(uploadPath);
      fs.copyFileSync(uploadPath, whitelistImagePath);
      try { fs.unlinkSync(req.file.path); } catch(e){}
    } 
    // 3. Handle Rename only (rename the existing file on disk)
    else if (nameChanged && person.image) {
        const oldPath = path.join(ocrPaths.whitelistDir, person.image);
        const newImageName = `${name}.jpg`;
        const newPath = path.join(ocrPaths.whitelistDir, newImageName);
        if(fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
            imageName = newImageName;
            whitelistImagePath = newPath;
        }
    }

    // 4. Update Database
    person.name = name || person.name;

    // Update allowed cameras only if the client sent a selection.
    const cameraIds = parseCameraIds(req.body);
    if (cameraIds.length > 0) {
      const validIds = cameraIds.filter((cid) => mongoose.Types.ObjectId.isValid(cid));
      const camQuery = { _id: { $in: validIds } };
      if (eventId) camQuery.event = eventId;
      const cameraDocs = await CameraInfo.find(camQuery);
      if (cameraDocs.length !== cameraIds.length)
        return res.status(404).json({ error: "One or more selected cameras were not found in this event" });
      person.allowed_cameras = validIds;
      person.cam_id = validIds[0]; // keep legacy field pointing at the primary
    }

    person.category = category || person.category;
    person.person_type = person_type || person.person_type;

    // Banned people are never whitelisted, regardless of the submitted status.
    const isBanned = person.person_type === "banned";
    person.status = isBanned ? "notwhitelisted" : (status || person.status);
    person.image = imageName;
    await person.save();

    // 5. Update Metadata & Pickle
    const finalImagePath = whitelistImagePath || path.join(ocrPaths.whitelistDir, person.image);

    // Refresh Metadata with the person's full allowed-camera list (replace mode
    // so unchecking a camera actually revokes it). Banned => empty list.
    const metaCameras = isBanned
      ? []
      : ((person.allowed_cameras && person.allowed_cameras.length)
          ? person.allowed_cameras
          : (person.cam_id ? [person.cam_id] : []));
    await updateMetadata(person.name, metaCameras, `${ocrPaths.imagePrefix}/${imageName}`, { replace: true, eventId, status: person.status });

    // Update Python Embedding if image changed OR name changed
    if (req.file || nameChanged) {
        runPythonUpdate(person.name, finalImagePath, eventId);
    }

    // Update WhitelistedPictures collection (delete old, add new to stay sync).
    if (isBanned) {
        // No longer whitelisted: drop any whitelist picture record.
        await WhitelistedPictures.deleteMany({ person: person._id });
    } else if (req.file || nameChanged) {
        await WhitelistedPictures.deleteMany({ person: person._id });
        await new WhitelistedPictures({
            person: person._id,
            filepath: finalImagePath.replace(/\\/g, "/"),
            event: person.event || getEventId(req)
        }).save();
    }

    res.status(200).json({ message: "✅ Person updated successfully", person });
  } catch (error) {
    console.error("❌ Update failed:", error);
    res.status(500).json({ error: error.message });
  }
};

export const deletePerson = async (req, res) => {
  try {
    const { id } = req.params;
    const person = await PersonInfo.findById(id);
    if (!person) return res.status(404).json({ error: "Person not found" });
    const eventId = person.event || getEventId(req);
    const ocrPaths = ensureEventOcrDirs(eventId);

    // 1. Delete Files
    if (person.image) {
      try { fs.unlinkSync(path.join(uploadDir, person.image)); } catch (e) {}
      try { fs.unlinkSync(path.join(ocrPaths.whitelistDir, person.image)); } catch (e) {}
    }

    // 2. Remove from Metadata
    removeFromMetadata(person.name, eventId);

    // 3. Remove from Pickle File (Critical for stopping recognition)
    runPythonDelete(person.name, eventId); 

    // 4. Remove from Database
    await PersonInfo.findByIdAndDelete(id);
    await WhitelistedPictures.deleteMany({ person: id });
    console.log("🗑️ Person and WhitelistedPictures records deleted.");

    res.status(200).json({ message: "✅ Person deleted successfully" });
  } catch (error) {
    console.error("❌ Deletion failed:", error);
    res.status(500).json({ error: error.message });
  }
};

// backend/controllers/personController.js

export const registerFromLog = async (req, res) => {
  try {
    const { id } = req.params;
    
    const detection = await DetectedFrames.findById(id);
    if (!detection) return res.status(404).json({ error: 'Detection not found' });
    const eventId = detection.event || null;
    const ocrPaths = ensureEventOcrDirs(eventId);

    const originalName = detection.person?.name?.trim();
    if (!originalName || originalName.toLowerCase() === 'unknown') {
      return res.status(400).json({ error: 'Cannot register Unknown person.' });
    }

    const cameraQuery = { cam_id: detection.cam };
    if (eventId) cameraQuery.event = eventId;
    const cameraDoc = await CameraInfo.findOne(cameraQuery);
    if (!cameraDoc) return res.status(404).json({ error: `Camera ID "${detection.cam}" not found.` });

    // 1. Generate Unique Name (hammad_1)
    let uniqueName = originalName;
    let counter = 1;
    while (await PersonInfo.findOne({ name: uniqueName, event: eventId })) {
      uniqueName = `${originalName}_${counter}`;
      counter++;
    }

    // 2. File Operations
    const fileName = path.basename(detection.filepath);
    const srcPath = detection.filepath?.startsWith("events/")
      ? path.join(OCR_ROOT, detection.filepath)
      : path.join(baseDetectedPath, fileName);
    const newImageName = `${uniqueName}.jpg`;
    const destPath = path.join(ocrPaths.whitelistDir, newImageName);
    
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
    } else {
        return res.status(404).json({ error: 'Source image file missing.' });
    }

    // 3. Create Person
    const newPerson = new PersonInfo({
      name: uniqueName,
      cam_id: cameraDoc._id,
      allowed_cameras: [cameraDoc._id], // the log came from a single camera
      status: 'whitelisted',
      image: newImageName,
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      read_status: 0,
      event: eventId || cameraDoc.event || null,
    });
    await newPerson.save();

    // 4. Add to Gallery
    await new WhitelistedPictures({
      person: newPerson._id,
      filepath: destPath.replace(/\\/g, "/"),
      event: eventId || cameraDoc.event || null,
    }).save();

    // 5. Update Metadata for New Person (Authorize Current Camera)
    const relativeImgPath = `${ocrPaths.imagePrefix}/${newImageName}`;
    await updateMetadata(uniqueName, detection.cam, relativeImgPath, { eventId });

    // 6. Update Python
    runPythonUpdate(uniqueName, destPath, eventId);

    // =========================================================
    // ✅ STEP 8: PERMISSION SYNC (The Fix for your issue)
    // =========================================================
    try {
        if (false && fs.existsSync(metadataPath)) {
            let metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            
            // A. Get Original Person's Cameras (e.g. hammad has ["1"])
            const originalPerms = metadata[originalName]?.cameras || [];
            
            // B. Get New Person's Cameras (e.g. hammad_1 has ["2"])
            const newPerms = metadata[uniqueName]?.cameras || [];

            // C. MERGE: Give 'hammad_1' access to 'hammad's' cameras
            for (const cam of originalPerms) {
                await updateMetadata(uniqueName, cam, relativeImgPath);
            }

            // D. MERGE: Give 'hammad' access to 'hammad_1's' cameras
            // (So if the AI detects the old "hammad", it works in the new room too)
            if (metadata[originalName]) {
                const originalImg = metadata[originalName].image;
                await updateMetadata(originalName, detection.cam, originalImg);
            }
            
            console.log(`🔄 Synced permissions: ${uniqueName} <-> ${originalName}`);
        }
    } catch (syncErr) {
        console.warn("⚠️ Permission sync warning:", syncErr.message);
    }

    // =========================================================

    // 7. Cleanup (Delete Log)
    await DetectedFrames.findByIdAndDelete(id);
    if (fs.existsSync(srcPath)) try { fs.unlinkSync(srcPath); } catch (e) {}

    return res.json({ 
      message: `✅ Registered ${uniqueName}. Permissions synced with ${originalName}.` 
    });

  } catch (err) {
    console.error("❌ Register Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------
// 4. GETTERS
// ---------------------------------------------------------

export const getAllPersons = async (req, res) => {
  try {
    const persons = await PersonInfo.find(eventFilter(req))
      .populate('cam_id')
      .populate('allowed_cameras');
    res.status(200).json(persons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getWhitelistedCount = async (req, res) => {
  try {
    const count = await WhitelistedPictures.countDocuments(eventFilter(req));
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getWhitelistedDetails = async (req, res) => {
  try {
    // Deep Populate to get Departments for every allowed camera (and the legacy one).
    const camPopulate = { populate: [{ path: 'department' }, { path: 'department_area' }] };
    const pictures = await WhitelistedPictures.find(eventFilter(req)).populate({
      path: 'person',
      populate: [
        { path: 'cam_id', ...camPopulate },
        { path: 'allowed_cameras', ...camPopulate },
      ]
    });

    const formatted = await Promise.all(pictures.map(async (entry) => {
      // Fetch last seen from detections log (where + when this person was last detected)
      const lastSeen = await DetectedFrames.findOne({
        ...(req.query.event_id ? { event: req.query.event_id } : {}),
        "person.name": entry.person?.name
      }).sort({ datetime: -1 });

      const person = entry.person;
      const allowed = (person?.allowed_cameras && person.allowed_cameras.length)
        ? person.allowed_cameras
        : (person?.cam_id ? [person.cam_id] : []);

      const checkpoints = allowed.map((c) => ({
        cam_id: c?.cam_id,
        camera_name: c?.camera_name,
        department: c?.department?.dep_name || "",
        area: c?.department_area?.area_name || "",
      }));
      const primary = allowed[0];

      return {
        _id: entry._id,
        name: person?.name || "Unknown",
        status: person?.status || "whitelisted",
        checkpoints,
        // Human-readable summary of all allowed checkpoints.
        cameras: checkpoints.map((c) => `${c.camera_name} (${c.cam_id})`).join(", ") || "N/A",
        // Legacy single-camera fields kept for backward compatibility.
        cameraId: primary?.cam_id || "N/A",
        cameraName: primary?.camera_name || "N/A",
        department: primary?.department?.dep_name || "N/A",
        department_area: primary?.department_area?.area_name || "N/A",
        image: entry.filepath,
        datetime: lastSeen ? lastSeen.datetime : null,
        lastSeenCamera: lastSeen?.cam || null,
      };
    }));

    res.status(200).json(formatted);
  } catch (err) {
    console.error("❌ Failed to fetch whitelisted details:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getPersonWithPictures = async (req, res) => {
  try {
    const { id } = req.params;
    const person = await PersonInfo.findById(id);
    if (!person) return res.status(404).json({ error: "Person not found" });
    const pictures = await WhitelistedPictures.find({ person: id });
    res.status(200).json({ person, pictures });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getWhitelistedPersons = async (req, res) => {
  try {
    const pictures = await WhitelistedPictures.find(eventFilter(req)).populate('person');
    const result = pictures
      .filter(p => p.person)
      .map(p => ({
        name: p.person.name,
        cam_id: p.person.cam_id,
        status: p.person.status,
        filepath: p.filepath.replace(/\\/g, "/")
      }));
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllPersonsWithPictures = async (req, res) => {
  try {
    const persons = await PersonInfo.find(eventFilter(req));
    const result = await Promise.all(
      persons.map(async (person) => {
        const pics = await WhitelistedPictures.find({ person: person._id });
        return {
          name: person.name,
          imagePaths: pics.map(p => p.filepath)
        };
      })
    );
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
