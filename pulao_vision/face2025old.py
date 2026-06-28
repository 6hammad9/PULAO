import datetime
import cv2
import jsonpickle
import requests
from numpy.linalg import norm
import json
import os
import sys

# Force UTF-8 stdout/stderr with replacement. A Windows cp1252 console raises
# UnicodeEncodeError on emoji/Unicode in a print(), which (in a worker thread)
# kills the thread and freezes the feed. Never let a log line crash the process.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import warnings
# from line_profiler_pycharm import profile
warnings.simplefilter(action='ignore', category=FutureWarning)
import pandas as pd
from scipy.spatial.distance import cosine
from typing import List, Optional, Union
import torch
import norfair
from norfair import Detection, Paths, Tracker, Video, OptimizedKalmanFilterFactory, get_cutout
from norfair.distances import frobenius, iou
from numpy import asarray
import time
import numpy as np
import pickle
import onnxruntime as ort
import glob
from scipy.spatial.distance import cosine
from dotenv import load_dotenv

load_dotenv()

def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not configured. Add it to OCR/.env.")
    return value

# Dynamically get the directory where face2025old.py is located
BASE_DIR = os.environ.get("OCR_BASE_DIR", os.path.dirname(os.path.abspath(__file__)))

# Define absolute model paths
YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", os.path.join(BASE_DIR, "models", "yolov5m_dynamic.onnx"))
GLINTR_PATH = os.environ.get("GLINTR_MODEL_PATH", os.path.join(BASE_DIR, "models", "glintr100.onnx"))
F2_MODEL_PATH = os.environ.get("F2_MODEL_PATH", os.path.join(BASE_DIR, "models", "f2.onnx"))

# Define whitelist folder and pickle file path
WHITELIST_FOLDER = os.environ.get("WHITELIST_FOLDER", os.path.join(BASE_DIR, "whitelisted"))
USERS_PKL_PATH = os.environ.get("USERS_PKL_PATH", os.path.join(BASE_DIR, "users.pkl"))
METADATA_PATH = os.environ.get("METADATA_PATH", os.path.join(BASE_DIR, "metadata.json"))
DETECTED_FOLDER = os.environ.get("DETECTED_FOLDER", os.path.join(BASE_DIR, "detected"))
EVENTS_ROOT = os.environ.get("OCR_EVENTS_DIR", os.path.join(BASE_DIR, "events"))
API_BASE_URL = required_env("API_BASE_URL").rstrip("/")
DETECTED_FRAMES_API = os.environ.get("DETECTED_FRAMES_API", f"{API_BASE_URL}/detectedframes")
RECOGNITION_THRESHOLD = float(os.environ.get("RECOGNITION_THRESHOLD", "0.35"))
PERSON_CONFIDENCE_THRESHOLD = float(os.environ.get("PERSON_CONFIDENCE_THRESHOLD", "0.80"))
DETECTION_LOG_INTERVAL_SECONDS = float(os.environ.get("DETECTION_LOG_INTERVAL_SECONDS", "5"))

def get_onnx_providers():
    available = ort.get_available_providers()
    providers = []
    if "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    providers.append("CPUExecutionProvider")
    return providers

ONNX_PROVIDERS = get_onnx_providers()

ort_sess = ort.InferenceSession(YOLO_MODEL_PATH, providers=ONNX_PROVIDERS)
ort_sess_r = ort.InferenceSession(GLINTR_PATH, providers=ONNX_PROVIDERS)
ort_sess2 = ort.InferenceSession(F2_MODEL_PATH, providers=ONNX_PROVIDERS)

def load_metadata(metadata_path=METADATA_PATH):
    if not os.path.exists(metadata_path):
        return {}
    try:
        with open(metadata_path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading metadata: {e}")
        return {}
def find_best_match(current_embedding, users_dict):
        best_match = None
        best_score = -1

        for name, stored_embedding in users_dict.items():
            similarity = compute_sim(current_embedding, stored_embedding)
            if similarity > best_score:
                best_score = similarity
                best_match = name

        # Return the closest enrolled identity and its raw similarity WITHOUT
        # thresholding. The caller applies acquire/release hysteresis + a frame
        # confirmation so a borderline face doesn't flip the committed identity
        # (and spam saves) frame to frame.
        return (best_match if best_match is not None else "na"), best_score

def event_paths(event_id=""):
    if not event_id:
        return {
            "whitelist": WHITELIST_FOLDER,
            "users": USERS_PKL_PATH,
            "metadata": METADATA_PATH,
            "detected": DETECTED_FOLDER,
        }

    event_root = os.path.join(EVENTS_ROOT, str(event_id))
    return {
        "whitelist": os.path.join(event_root, "whitelisted"),
        "users": os.path.join(event_root, "users.pkl"),
        "metadata": os.path.join(event_root, "metadata.json"),
        "detected": os.path.join(event_root, "detected"),
    }

def get_person_status(name, camid, metadata):
    camid_str = str(camid)
    if name in metadata:
        if camid_str in metadata[name].get("cameras", []):
            return "whitelisted"
    return "notwhitelisted"

def detected_path(*parts, event_id=""):
    return os.path.join(event_paths(event_id)["detected"], *parts)

def detection_rel_path(findings, filename, event_id=""):
    if event_id:
        return f"events/{event_id}/detected/{findings}/{filename}"
    return f"{findings}/{filename}"

def post_detection_event(person, camid, status, event_status, filepath="", duration_seconds=None, event_id=""):
    payload = {
        "cam": str(camid),
        "track_id": int(person.event_track_id),
        "filepath": filepath or person.saved_filepath,
        "findings": status,
        "confidence": float(person.last_confidence or 0.0),
        "person": {
            "name": person.person_name,
            "status": status,
            "color": "#ffffff"
        },
        "seen": 1,
        "entered_at": person.entered_at.isoformat(),
        "event_status": event_status,
    }

    if event_id:
        payload["event_id"] = str(event_id)
    if duration_seconds is not None:
        payload["duration_seconds"] = float(duration_seconds)
    if person.exited_at is not None:
        payload["exited_at"] = person.exited_at.isoformat()

    try:
        requests.post(DETECTED_FRAMES_API, json=payload, timeout=2)
    except Exception as e:
        print(f"[WARNING] Detection event post failed: {e}")

class Person:
    def __init__(self, det_time, exit_time, duration, det_history, person_name,
                 person_id, status='', f=None, p=None):
        if p is None:
            p = list()
        if f is None:
            f = list()
        self.det_time = det_time
        self.firstTime = True
        self.firstTimeName = False
        self.firstTimeNameCheck = True
        self.firstTimeNA = True
        self.exit_time = exit_time
        self.duration = duration
        self.det_history = det_history
        self.person_name = person_name
        self.person_id = person_id
        self.status = status
        self.det_face: list = f
        self.det_person: list = p
        self.db_entry_created = False
        self.last_seen = det_time
        self.entry_cooldown = False
        self.saved = False
        # (person_name, status) at the moment we last saved this track. Lets a
        # track first saved as 'na/unclear' re-save once it is recognized.
        self.saved_identity = None
        self.entered_at = det_time
        self.exited_at = None
        self.last_confidence = 0.0
        self.last_status = status
        self.saved_filepath = ""
        self.missing_since = None
        self.event_track_id = person_id
        self.last_match_log_at = 0.0
        # Identity debounce: a candidate identity must persist for
        # IDENTITY_CONFIRM_FRAMES frames before it overwrites person_name, so a
        # borderline/ambiguous face can't flip the committed identity (and spam
        # detection events) frame to frame.
        self.pending_name = None
        self.pending_count = 0
MIN_REENTRY_SECONDS = 5
EXIT_GRACE_SECONDS = float(os.environ.get("EXIT_GRACE_SECONDS", "5"))
MATCH_LOG_INTERVAL_SECONDS = float(os.environ.get("MATCH_LOG_INTERVAL_SECONDS", "5"))
TRACK_SWITCH_SECONDS = float(os.environ.get("TRACK_SWITCH_SECONDS", "8"))
# Recognition hysteresis + debounce. ACQUIRE a name only when similarity clears
# the high bar; RELEASE it (back to na) only below the low bar; hold the current
# identity in the dead-band between. A change must also persist for
# IDENTITY_CONFIRM_FRAMES frames before it's committed, so a borderline/ambiguous
# face can't flip the identity (and spam detection events) frame to frame.
RECOGNITION_ACQUIRE_THRESHOLD = float(os.environ.get("RECOGNITION_ACQUIRE_THRESHOLD", "0.40"))
RECOGNITION_RELEASE_THRESHOLD = float(os.environ.get("RECOGNITION_RELEASE_THRESHOLD", "0.28"))
IDENTITY_CONFIRM_FRAMES = int(os.environ.get("IDENTITY_CONFIRM_FRAMES", "3"))
UNKNOWN_SAVE_COOLDOWN_SECONDS = float(os.environ.get("UNKNOWN_SAVE_COOLDOWN_SECONDS", "8"))

def details(self):
        return 3

    
debug = False

# Detection class instantiated in app.py
class Detections:
    # instantiate with input size the model takes, we are using 320x320 size models
    def __init__(self, wf, hf, wp, hp):
        self.WIDTH_FACE = wf
        self.HEIGHT_FACE = hf
        self.WIDTH_PERSON = wp
        self.HEIGHT_PERSON = hp
        self.person_list = []
        self.last_detection_log_at = 0.0
        self.last_unclear_save_at = 0.0
    
    # Detects faces and persons from the provided image
    def get_detections(self, img):
        start_time = time.perf_counter()
        try:
            image = img.copy()
            row, col, d = image.shape
            # add black regions in image to preserve aspect ratio
            max_rc = max(row, col)
            input_image = np.zeros((max_rc, max_rc, 3), dtype=np.uint8)
            input_image[0:row, 0:col] = image

            # converts the image to standard format that can be used to run inference
            blob = cv2.dnn.blobFromImage(input_image, 1 / 255, (self.WIDTH_FACE, self.HEIGHT_FACE), swapRB=True,
                                         crop=False)
            blob2 = blob

            # run inference on the processed image both for face n person
            preds = ort_sess.run(None, {'images': blob2})
            preds_f = ort_sess2.run(None, {'input': blob})

            detections = preds[0][0]
            detections_f = preds_f[0][0]
            end_time = time.perf_counter()
        except Exception as e:
            print(f"Error copying image: {e}")
            return None, None, None

        if debug:
            print('det', end_time - start_time)
        return input_image, detections, detections_f
   
    # supress overlapping detections which have lower probabilities
    def non_maximum_supression(self, input_image, detections_f, detections, c=0.25, pf=0.6, pp=0.6, str=""):
        start_time = time.perf_counter()
        index_face = cv2.dnn.NMSBoxes(detections_f[:, :4].tolist(), detections_f[:, 4].tolist(), pf, c)
        index_person = cv2.dnn.NMSBoxes(detections[:, :4].tolist(), detections[:, 4].tolist(), pp, c)
        end_time = time.perf_counter()
        if debug:
            print('nms: ', end_time - start_time)
        return index_face, index_person
    # Performs following functions
    def extract_text(self, image, bboxes, bboxes_p, tracker, camid, event_id=""):
        start_time = time.perf_counter()
        frame_h, frame_w = image.shape[:2]
        scale = max(frame_h, frame_w) / 320
        if len(bboxes_p) < 1: return image
        # Load this event's recognition data ONCE per frame. It is cached and
        # isolated per event, so a concurrent worker for a different event can't
        # swap the embeddings/permissions out from under us mid-frame.
        event_users, event_metadata = check_and_reload_data(event_id=event_id)
        bboxes_p[:, 2] = bboxes_p[:, 2] - bboxes_p[:, 0]
        bboxes_p[:, 3] = bboxes_p[:, 3] - bboxes_p[:, 1]
        d = (bboxes_p[:, :4] * scale).astype(np.int32)
        d[:, [0, 2]] = np.clip(d[:, [0, 2]], 0, frame_w - 1)
        d[:, [1, 3]] = np.clip(d[:, [1, 3]], 0, frame_h - 1)
        bboxes_p = np.hstack([d, bboxes_p[:, 4].reshape([-1, 1])])
        if len(bboxes) > 0:
            bboxes[:, 2] = bboxes[:, 2] - bboxes[:, 0]
            bboxes[:, 3] = bboxes[:, 3] - bboxes[:, 1]
            bboxes = bboxes[:, :4] * scale
            bboxes = bboxes.astype(np.int32)
            bboxes[:, [0, 2]] = np.clip(bboxes[:, [0, 2]], 0, frame_w - 1)
            bboxes[:, [1, 3]] = np.clip(bboxes[:, [1, 3]], 0, frame_h - 1)

        detections = yolo_detections_to_norfair_detections(bboxes_p, track_points='bbox')
        for detection in detections:
            cut = get_cutout(detection.points, image)
            if cut.shape[0] > 0 and cut.shape[1] > 0:
                detection.embedding = get_hist(cut)
            else:
                detection.embedding = None
        tracked_objects = tracker.update(detections=detections)

        for x in tracked_objects:
            found = False
            for p in self.person_list:
                if len(self.person_list) > 0 and x.id == p.person_id:
                    found = True
                    p.missing_since = None
                    p.last_seen = datetime.datetime.now()
                    p.det_person = np.array([*x.last_detection.points[0], *x.last_detection.points[1]])
                    z = p.det_person
                    a = [iouc(xywh2x1y1x2y2(i), z) for i in bboxes]
                    if a:
                        if not all(max(a) == 0):
                            index = np.argmax(a)
                            p.det_face = bboxes[index]
                        else:
                            p.det_face = []

                    if p.firstTime or p.firstTimeName:
                        p.firstTime = False
                        if p.firstTimeName:
                            p.firstTimeNameCheck = False
                            p.firstTimeName = False

                        dp = p.det_person.astype(int)
                        img = image[dp[1]:dp[3], dp[0]:dp[2]]
                        filename = str(np.random.randint(100000000)) + '.jpg'

                        # ✅ Correct logic: First check if it's unknown (na)
                        if p.person_name == 'na':
                            folder = detected_path("unclear", event_id=event_id)
                        else:
                            status = get_person_status(p.person_name, camid, event_metadata)  # 'whitelisted' or 'notwhitelisted'
                            folder = detected_path(status, event_id=event_id)

                        # Early snapshots are intentionally not written.
                        # The gallery image is saved once below when a DB
                        # detection event is created.

            if not found:
                d = Person(datetime.datetime.now(), datetime.datetime.now(), 0, 3, 'na', x.id)
                d.status = 'An unidentified person has appeared in camera'
                d.det_person = np.array([*x.last_detection.points[0], *x.last_detection.points[1]])

                dp = d.det_person.astype(int)
                img = image[dp[1]:dp[3], dp[0]:dp[2]]

                if d.firstTimeNA:
                    d.firstTimeNA = False
                    filename = str(np.random.randint(100000000)) + '.jpg'
                    # Early unknown snapshots are intentionally not written.
                    # The gallery image is saved once below when a DB
                    # detection event is created.

                z = d.det_person
                a = [iouc(xywh2x1y1x2y2(i), z) for i in bboxes]
                if a:
                    index = np.argmax(a)
                    d.det_face = bboxes[index]
                else:
                    d.det_face = []
                self.person_list.append(d)

        for p in list(self.person_list):
            found = False
            for x in tracked_objects:
                if len(tracked_objects) > 0:
                    if x.id == p.person_id:
                        found = True
            if not found:
                now = datetime.datetime.now()
                if p.missing_since is None:
                    p.missing_since = now
                    continue

                missing_seconds = (now - p.missing_since).total_seconds()
                if missing_seconds < EXIT_GRACE_SECONDS:
                    continue

                exit_time = p.missing_since
                duration = (exit_time - p.det_time).total_seconds()
                p.exited_at = exit_time
                
                print(f"[EXIT] Person {p.person_name} (ID: {p.person_id}) left. Duration: {duration:.1f}s")
                if p.saved:
                    post_detection_event(
                        p,
                        camid,
                        p.last_status or "unclear",
                        "closed",
                        duration_seconds=duration,
                        event_id=event_id,
                    )
                
                self.person_list.remove(p)

        try:
            if len(self.person_list) > 0:
                images = []
                batch = []
                face_tracks = []

                h_img, w_img = image.shape[:2]
                for bb in self.person_list:
                    if len(bb.det_face) > 0:
                        x1, y1, width, height = bb.det_face
                        x2, y2 = x1 + width, y1 + height
                        x1 = max(0, min(int(x1), w_img))
                        y1 = max(0, min(int(y1), h_img))
                        x2 = max(0, min(int(x2), w_img))
                        y2 = max(0, min(int(y2), h_img))
                        if x2 <= x1 or y2 <= y1:
                            continue
                        images.append(image[y1:y2, x1:x2])
                        face_tracks.append(bb)

                batch = []
                for x in images:
                    img = cv2.resize(x, (112, 112))
                    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                    img = np.transpose(img, (2, 0, 1))  # CHW
                    img = img.astype(np.float32) / 255.0
                    batch.append(img)

                if len(batch) > 0:
                    matches = []
                    embeddings = []

                    for face_tensor in batch:
                        face_batch = np.expand_dims(face_tensor, axis=0)
                        pred = ort_sess_r.run(None, {'input.1': face_batch})
                        embeddings.append(pred[0][0])

                    for face_embedding in embeddings:
                        if event_users:
                            name, similarity = find_best_match(face_embedding, event_users)
                        else:
                            print("[WARNING] No embeddings available. Skipping recognition.")
                            name = "na"
                            similarity = 0.0

                        matches.append((name, similarity))


                    for bb, (n, similarity) in zip(face_tracks, matches):
                        if len(bb.det_face) > 0:
                            bb.last_confidence = similarity
                            # Acquire/release hysteresis: pick the identity this
                            # frame WANTS, holding the current one in the ambiguous
                            # dead-band so a face hovering near the threshold doesn't
                            # flip na<->name every frame.
                            if similarity <= RECOGNITION_RELEASE_THRESHOLD:
                                # A very low similarity is not ambiguous. It is
                                # definitely not the committed identity, so drop
                                # stale names immediately instead of waiting for
                                # confirmation frames. This prevents "Hammad" /
                                # "Suleman" logs at 0-2% confidence.
                                if bb.person_name != 'na':
                                    print(f"[IDENTITY RESET] Track {bb.person_id}: '{bb.person_name}' -> na (low sim {similarity:.3f})")
                                bb.person_name = 'na'
                                bb.pending_name = None
                                bb.pending_count = 0
                                desired = 'na'
                            elif similarity >= RECOGNITION_ACQUIRE_THRESHOLD:
                                desired = n
                            else:
                                desired = bb.person_name

                            # Confirmation debounce: only commit a CHANGED identity
                            # after it has persisted for a few frames. This is what
                            # stops the "Hammad restricted / Unknown na ..." save
                            # spam on a borderline/ambiguous face.
                            if desired == bb.person_name:
                                bb.pending_name = None
                                bb.pending_count = 0
                            else:
                                if desired == bb.pending_name:
                                    bb.pending_count += 1
                                else:
                                    bb.pending_name = desired
                                    bb.pending_count = 1
                                if bb.pending_count >= IDENTITY_CONFIRM_FRAMES:
                                    prev_name = bb.person_name
                                    bb.person_name = desired
                                    bb.pending_name = None
                                    bb.pending_count = 0
                                    if desired != 'na' and bb.firstTimeNameCheck:
                                        bb.firstTimeName = True
                                    print(f"[IDENTITY] Track {bb.person_id}: '{prev_name}' -> '{desired}' (sim {similarity:.3f})")

                            now = datetime.datetime.now()
                            # elapsed = (now - bb.last_seen).total_seconds()
                            # should_create_entry = not bb.db_entry_created or elapsed > MIN_REENTRY_SECONDS
                            bb.last_seen = now  
                            # if should_create_entry:
                            if bb.person_name == 'na':
                                status = "unclear"
                            else:
                                status = get_person_status(bb.person_name, camid, event_metadata)
                            bb.last_status = status

                            now_ts = time.time()
                            if now_ts - bb.last_match_log_at >= MATCH_LOG_INTERVAL_SECONDS:
                                print(f"[MATCH] Track {bb.person_id}: {bb.person_name} ({similarity:.3f})")
                                bb.last_match_log_at = now_ts

                            # 2. Prepare Unique Filename (Prevents Overwriting)
                            # Example: 1735167890_105.jpg
                            timestamp = int(time.time())
                            filename = f"{timestamp}_{bb.person_id}.jpg"

                            # 3. Save when first seen, OR when the track's identity
                            # changes — e.g. an 'na/unclear' track that later gets
                            # recognized must re-save as whitelisted/notwhitelisted,
                            # otherwise it stays only in the unclear folder.
                            identity = (bb.person_name, status)

                            # Track-switch de-dup only applies to the FIRST save, so
                            # one person isn't double-counted across track-id changes.
                            if not bb.saved and bb.person_name != 'na':
                                for other in list(self.person_list):
                                    if other is bb or not other.saved:
                                        continue
                                    if other.person_name != bb.person_name or other.last_status != status:
                                        continue

                                    # Only absorb a track that has ACTUALLY gone
                                    # missing (a genuine ID switch). Merging a track
                                    # still visible this frame is wrong — two
                                    # concurrent detections may be two real people,
                                    # and it made tracks ping-pong (5->6->5...),
                                    # churning saves.
                                    if other.missing_since is None:
                                        continue
                                    missing_age = (now - other.missing_since).total_seconds()
                                    if missing_age <= TRACK_SWITCH_SECONDS:
                                        bb.saved = True
                                        bb.saved_identity = getattr(other, "saved_identity", None)
                                        bb.db_entry_created = other.db_entry_created
                                        bb.entered_at = other.entered_at
                                        bb.saved_filepath = other.saved_filepath
                                        bb.event_track_id = other.event_track_id
                                        bb.last_confidence = max(bb.last_confidence, other.last_confidence)
                                        bb.last_match_log_at = other.last_match_log_at
                                        self.person_list.remove(other)
                                        print(
                                            f"[TRACK SWITCH] Continuing {bb.person_name}: "
                                            f"{other.person_id} -> {bb.person_id}"
                                        )
                                        break

                            needs_save = (not bb.saved) or (getattr(bb, "saved_identity", None) != identity)
                            if needs_save and status == "unclear":
                                if now_ts - self.last_unclear_save_at < UNKNOWN_SAVE_COOLDOWN_SECONDS:
                                    needs_save = False
                                else:
                                    self.last_unclear_save_at = now_ts
                            if needs_save:
                                bb.saved = True
                                bb.saved_identity = identity
                                bb.db_entry_created = True

                                x, y, w, h = bb.det_face
                                
                                # Visuals (Draw Box)
                                color = (0, 255, 0) if status == "whitelisted" else (0, 0, 255)
                                if bb.person_name == 'na': color = (255, 0, 255)
                                cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)

                                # 4. STRICT FOLDER SEPARATION
                                # Detections go to the detected folder, never the whitelist folder.
                                findings = status 
                                folder_path = detected_path(findings, event_id=event_id)
                                os.makedirs(folder_path, exist_ok=True)
                                
                                save_path = os.path.join(folder_path, filename)
                                face_img = image[y:y+h, x:x+w]

                                if face_img.size > 0:
                                    cv2.imwrite(save_path, face_img)
                                    print(f"[SAVED] {save_path}") # Check console to verify path

                                    rel_path = detection_rel_path(findings, filename, event_id=event_id)
                                    bb.saved_filepath = rel_path
                                    post_detection_event(
                                        bb,
                                        camid,
                                        findings,
                                        "open",
                                        filepath=rel_path,
                                        event_id=event_id,
                                    )

                            else:
                                # Just Track (No Saving)
                                x, y, w, h = bb.det_face
                                color = (255, 0, 0) if bb.person_name != 'na' else (255, 0, 255)
                                cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)
                                
                                # Use the 'status' we defined at the top
                                label = f"{bb.person_name} {status}"
                                cv2.putText(image, label, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 1)
                                # x, y, w, h = bb.det_face
                                # color = (255, 0, 0) if bb.person_name != 'na' else (255, 0, 255)
                                # cv2.rectangle(image, (x, y), (x + w, y + h), color, 2)
                                # cv2.rectangle(image, (x, y - 30), (x + w, y), color, -1)
                                # cv2.rectangle(image, (x, y + h), (x + w, y + h + 30), (0, 0, 0), -1)
                                # status = get_person_status(bb.person_name, camid)
                                # label = f"{bb.person_name} {status}"
                                # cv2.putText(image, label, (x, y + h + 27), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 1)

        except BaseException as e:
            print('exception')
            print(e, e.__traceback__.tb_lineno)

        draw_person_tracks(image, tracked_objects)
        end_time = time.perf_counter()
        if debug:
            print('recog: ', end_time - start_time)
        return image
    def yolo_predictions(self, frame, tracker, camid, event_id=""):
        start_time = time.perf_counter()
        frames = frame
        input_image, detections, detections_f = self.get_detections(frames)
        if detections is None or detections_f is None:
            return frames

        raw_person_count = len(detections)
        raw_face_count = len(detections_f)
        detections = detections[detections[:, 5] >= PERSON_CONFIDENCE_THRESHOLD]

        indF = cv2.dnn.NMSBoxes(detections_f[:, :4].tolist(), detections_f[:, 4].tolist(), 0.6, 0.4)
        indP = cv2.dnn.NMSBoxes(detections[:, :4].tolist(), detections[:, 4].tolist(), 0.40, 0.4)
        if len(indF) > 0:
            indF = xywh2xyxy(detections_f[indF][:, :4])
        else:
            indF = np.array([])
        if len(indP) > 0:
            indP = xywh2xyxy(detections[indP][:, :5])
        else:
            indP = np.array([])

        now_ts = time.time()
        if now_ts - self.last_detection_log_at >= DETECTION_LOG_INTERVAL_SECONDS:
            print(
                f"[DETECT] cam={camid} raw_person={raw_person_count} "
                f"person_after_conf={len(detections)} person_nms={len(indP)} "
                f"raw_face={raw_face_count} face_nms={len(indF)}"
            )
            self.last_detection_log_at = now_ts

        result_img = self.extract_text(frames, indF, indP, tracker, camid, event_id=event_id)
        end_time = time.perf_counter()

        if debug:
            print('loop: ', end_time - start_time)
        return result_img


def embedding_distance(matched_not_init_trackers, unmatched_trackers):
    snd_embedding = unmatched_trackers.last_detection.embedding

    if snd_embedding is None:
        for detection in reversed(unmatched_trackers.past_detections):
            if detection.embedding is not None:
                snd_embedding = detection.embedding
                break
        else:
            return 1

    for detection_fst in matched_not_init_trackers.past_detections:
        if detection_fst.embedding is None:
            continue

        distance = 1 - cv2.compareHist(
            snd_embedding, detection_fst.embedding, cv2.HISTCMP_CORREL
        )
        if distance < 0.5:
            return distance
    return 1


def iouc(bboxes1, bboxes2):
    x11, y11, x12, y12 = np.split(bboxes1, 4, axis=0)
    x21, y21, x22, y22 = np.split(bboxes2, 4, axis=0)
    xA = np.maximum(x11, np.transpose(x21))
    yA = np.maximum(y11, np.transpose(y21))
    xB = np.minimum(x12, np.transpose(x22))
    yB = np.minimum(y12, np.transpose(y22))
    interArea = np.maximum((xB - xA + 1), 0) * np.maximum((yB - yA + 1), 0)
    boxAArea = (x12 - x11 + 1) * (y12 - y11 + 1)
    boxBArea = (x22 - x21 + 1) * (y22 - y21 + 1)
    iou = interArea / (boxAArea + np.transpose(boxBArea) - interArea)
    return iou


def xywh2xyxy(x):
    x[:, 0] = x[:, 0] - x[:, 2] / 2
    x[:, 1] = x[:, 1] - x[:, 3] / 2
    x[:, 2] = x[:, 0] + x[:, 2]
    x[:, 3] = x[:, 1] + x[:, 3]
    return x


def xywh2x1y1x2y2(x):
    y = np.copy(x[:4])
    y[2] = y[0] + y[2]
    y[3] = y[1] + y[3]
    return y


def yolo_detections_to_norfair_detections(
        yolo_detections: torch.tensor, track_points: str = "bbox"
) -> List[Detection]:
    norfair_detections: List[Detection] = []
    for detection_as_xyxy in yolo_detections:
        bbox = np.array(
            [
                [detection_as_xyxy[0], detection_as_xyxy[1]],
                [detection_as_xyxy[0] + detection_as_xyxy[2], detection_as_xyxy[1] + detection_as_xyxy[3]],
            ]
        )
        score = float(detection_as_xyxy[4]) if len(detection_as_xyxy) > 4 else 1.0
        norfair_detections.append(
            Detection(
                points=bbox,
                scores=np.array([score, score], dtype=float),
                data={"score": score},
                label="person",
            )
        )
    return norfair_detections


def draw_person_tracks(image, tracked_objects):
    for obj in tracked_objects:
        points = getattr(getattr(obj, "last_detection", None), "points", None)
        if points is None:
            points = getattr(obj, "estimate", None)
        if points is None:
            continue

        x1, y1 = points[0].astype(int)
        x2, y2 = points[1].astype(int)
        x1 = max(0, min(image.shape[1] - 1, x1))
        y1 = max(0, min(image.shape[0] - 1, y1))
        x2 = max(0, min(image.shape[1] - 1, x2))
        y2 = max(0, min(image.shape[0] - 1, y2))

        cv2.rectangle(image, (x1, y1), (x2, y2), (60, 180, 255), 2)
        label = f"ID {getattr(obj, 'id', '?')}"
        cv2.putText(
            image,
            label,
            (x1, max(15, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (60, 180, 255),
            2,
        )


d = Detections(320, 320, 320, 320)


def getEmbed(file):
    """Generate face embedding from an image file with robust error handling"""
    try:
        # Load image with validation
        img = cv2.imread(file)
        if img is None:
            raise ValueError(f"Could not read image: {file}")
        
        # Get detections with error handling
        input_image, detections, detections_f = d.get_detections(img)
        if detections_f is None or len(detections_f) == 0:
            raise ValueError("No faces detected")
        
        # Process detections safely
        indF, _ = d.non_maximum_supression(input_image, detections_f, np.zeros((0, 6)))
        if len(indF) == 0:
            raise ValueError("No valid faces after NMS")
        
        # Convert and scale bounding box
        boxes_np = xywh2xyxy(detections_f[indF][:, :4])
        scale = input_image.shape[1] / 320
        boxes_np = boxes_np * scale
        
        # Get first face with boundary checks
        x1, y1, x2, y2 = boxes_np[0].astype(np.int32)
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img.shape[1], x2)
        y2 = min(img.shape[0], y2)
        
        # Validate face region
        if x1 >= x2 or y1 >= y2:
            raise ValueError("Invalid face coordinates")
            
        face = img[y1:y2, x1:x2]
        if face.size == 0:
            raise ValueError("Empty face crop")
        
        # Preprocess face
        face = cv2.resize(face, (112, 112))
        face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)  # Convert to RGB
        face = np.transpose(face, (2, 0, 1))  # CHW format
        face = (face / 255.0).astype(np.float32)  # Normalize
        
        # Generate embedding
        blob = np.expand_dims(face, axis=0)  # Add batch dimension
        pred = ort_sess_r.run(None, {'input.1': blob})
        return pred[0][0]  # Return first embedding
        
    except Exception as e:
        print(f"Error in getEmbed for {file}: {str(e)}")
        return np.zeros(512)  # Return zero embedding on failure



# Load embeddings from local files
# users = {
#     "imran": getEmbed(file=r"./OCR/data2/imran.PNG"),
#     "hammad": getEmbed(file=r"./OCR/data2/hammad.jpeg"),
#     "Abu": getEmbed(file=r"./OCR/data2/Abu.jpeg"),
#     "Fahad": getEmbed(file=r"./OCR/data2/Fahad.jpeg"),
    
# }

# Load face embeddings from a folder and save as users.pkl
# -----------------------------------------------------------
# DYNAMIC USER LOADING LOGIC (HOT RELOAD)
# -----------------------------------------------------------

# Recognition data (face embeddings + camera permissions) is cached PER EVENT,
# keyed by event id, so concurrent camera workers belonging to different events
# can't overwrite each other's data. See check_and_reload_data().
_event_data = {}
def generate_encodings_from_folder(WHITELIST_FOLDER, USERS_PKL_PATH):
    """Regenerates the pickle file from the images folder."""
    temp_users = {}
    image_paths = glob.glob(os.path.join(WHITELIST_FOLDER, "*.*"))

    for path in image_paths:
        try:
            name = os.path.splitext(os.path.basename(path))[0]
            embedding = getEmbed(path)
            if embedding is not None and np.any(embedding):
                print(f"[DEBUG] Saving {name}, embedding shape: {embedding.shape}")
                temp_users[name] = embedding
                print(f"[INFO] Encoded: {name}")
        except Exception as e:
            print(f"[ERROR] Failed to encode {path}: {e}")
    
    os.makedirs(os.path.dirname(USERS_PKL_PATH), exist_ok=True)

    with open(USERS_PKL_PATH, "wb") as f:
        pickle.dump(temp_users, f)

    print(f"[INFO] Saved all encodings to {USERS_PKL_PATH}")

def check_and_reload_data(event_id=""):
    """Return (users, metadata) for `event_id`, hot-reloading from disk when the
    event's users.pkl / metadata.json change.

    Recognition data is cached PER EVENT (keyed by event id) instead of in one
    set of process-wide globals. Previously every worker shared a single
    users/metadata pair that this function swapped on each event change, so two
    workers from different events could overwrite each other's data and match
    faces against the wrong event's whitelist. A reload rebinds the cached dict
    (it never mutates it in place), so a caller holding the returned reference
    always sees a consistent snapshot.
    """
    paths = event_paths(event_id)
    users_pkl_path = paths["users"]
    metadata_path = paths["metadata"]
    scope = str(event_id or "__legacy__")

    entry = _event_data.get(scope)
    if entry is None:
        entry = {"users": {}, "metadata": {}, "users_ts": 0, "metadata_ts": 0}
        _event_data[scope] = entry

    # 1. Check Pickle (Embeddings)
    try:
        if os.path.exists(users_pkl_path):
            current_pkl_ts = os.path.getmtime(users_pkl_path)
            if current_pkl_ts > entry["users_ts"]:
                # Wait briefly for Node.js to finish writing
                time.sleep(0.1)
                
                with open(users_pkl_path, "rb") as f:
                    entry["users"] = pickle.load(f)
                entry["users_ts"] = current_pkl_ts
                print(f"[SUCCESS] Hot Reload [{scope}]: Embeddings updated ({len(entry['users'])} users).")
        elif entry["users"]:
            entry["users"] = {}
            entry["users_ts"] = 0
            print(f"[INFO] No event embeddings found at {users_pkl_path}; recognition list cleared.")
    except Exception as e:
        print(f"[WARNING] Pickle reload failed: {e}")

    # 2. Check Metadata (Permissions)
    try:
        if os.path.exists(metadata_path):
            current_meta_ts = os.path.getmtime(metadata_path)
            if current_meta_ts > entry["metadata_ts"]:
                time.sleep(0.1)
                
                entry["metadata"] = load_metadata(metadata_path)
                entry["metadata_ts"] = current_meta_ts
                print(f"[SUCCESS] Hot Reload [{scope}]: Metadata updated ({len(entry['metadata'])} entries).")
        elif entry["metadata"]:
            entry["metadata"] = {}
            entry["metadata_ts"] = 0
            print(f"[INFO] No event metadata found at {metadata_path}; permissions cleared.")
    except Exception as e:
        print(f"[WARNING] Metadata reload failed: {e}")

    return entry["users"], entry["metadata"]

# Perform Initial Load
check_and_reload_data()
def compute_sim(feat1, feat2):
    if np.all(feat1 == 0) or np.all(feat2 == 0):
        return 0.0  # No similarity for empty embeddings
    return np.dot(feat1, feat2) / (norm(feat1) * norm(feat2))


def get_hist(image):
    hist = cv2.calcHist(
        [cv2.cvtColor(image, cv2.COLOR_BGR2Lab)],
        [0, 1],
        None,
        [128, 128],
        [0, 256, 0, 256],
    )
    return cv2.normalize(hist, hist).flatten()
