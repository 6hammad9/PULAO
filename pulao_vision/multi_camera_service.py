import os
import sys

# Windows consoles default to a legacy code page (cp1252) that can't encode the
# emoji/Unicode that some log lines contain. An unencodable print() raises
# UnicodeEncodeError, and inside a worker thread that kills the thread — which
# froze the mobile feed permanently. Force UTF-8 with replacement so a log line
# can never crash the process.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# RTSP/HTTP network streams are unreliable under OpenCV's defaults: UDP transport
# drops packets and a dead host blocks forever. Force TCP and apply open/read
# timeouts (microseconds) at the FFMPEG layer. Must be set before the first
# VideoCapture is opened, so configure it here at import time.
RTSP_TRANSPORT = os.environ.get("RTSP_TRANSPORT", "tcp")
NETWORK_OPEN_TIMEOUT_US = os.environ.get("NETWORK_OPEN_TIMEOUT_US", "8000000")
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    f"rtsp_transport;{RTSP_TRANSPORT}|stimeout;{NETWORK_OPEN_TIMEOUT_US}|"
    f"timeout;{NETWORK_OPEN_TIMEOUT_US}",
)

import base64
import datetime
import html
import threading
import time
from urllib.parse import urlsplit, urlunsplit

import cv2
import numpy as np
import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

load_dotenv()

from byte_tracker import ByteTrackAdapter
from face2025old import Detections

def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not configured. Add it to OCR/.env.")
    return value

API_BASE_URL = required_env("API_BASE_URL").rstrip("/")
ACTIVE_EVENT_ID = os.environ.get("VISION_EVENT_ID", "").strip()
SERVICE_HOST = os.environ.get("VISION_HOST", "0.0.0.0")
SERVICE_PORT = int(os.environ.get("VISION_PORT", "6033"))
SERVICE_HTTPS_PORT = int(os.environ.get("VISION_HTTPS_PORT", "6443"))
ENABLE_HTTPS = os.environ.get("VISION_ENABLE_HTTPS", "1") == "1"
USE_WAITRESS = os.environ.get("VISION_USE_WAITRESS", "1") == "1"
REQUIRE_EVENT_CONTEXT = os.environ.get("VISION_REQUIRE_EVENT_CONTEXT", "1") == "1"
CAMERA_POLL_SECONDS = int(os.environ.get("CAMERA_POLL_SECONDS", "10"))
FRAME_SKIP = int(os.environ.get("VISION_FRAME_SKIP", "1"))
RECONNECT_SECONDS = int(os.environ.get("CAMERA_RECONNECT_SECONDS", "5"))
JPEG_QUALITY = int(os.environ.get("STREAM_JPEG_QUALITY", "80"))
READ_FAIL_LIMIT = int(os.environ.get("CAMERA_READ_FAIL_LIMIT", "30"))
TEST_READ_TIMEOUT = float(os.environ.get("CAMERA_TEST_TIMEOUT", "10"))
# Per-capture open/read timeouts (ms) for network streams, so a stalled feed
# makes read() fail fast and the worker reconnects instead of freezing.
NETWORK_OPEN_TIMEOUT_MS = int(os.environ.get("NETWORK_OPEN_TIMEOUT_MS", "8000"))
NETWORK_READ_TIMEOUT_MS = int(os.environ.get("NETWORK_READ_TIMEOUT_MS", "8000"))
# Force a reconnect if no frame has decoded for this long (covers a wedged read
# that never returns a clean failure).
STREAM_STALL_SECONDS = float(os.environ.get("STREAM_STALL_SECONDS", "12"))
MOBILE_STALE_IDENTITY_NA_STREAK = int(os.environ.get("MOBILE_STALE_IDENTITY_NA_STREAK", "2"))
RECOGNITION_RELEASE_THRESHOLD = float(os.environ.get("RECOGNITION_RELEASE_THRESHOLD", "0.28"))


app = Flask(__name__)
workers = {}
workers_lock = threading.Lock()
sync_trigger_lock = threading.Lock()


def get_camera_event_id(camera):
    event = camera.get("event") or camera.get("event_id") or ""
    if isinstance(event, dict):
        return str(event.get("_id") or event.get("id") or "")
    return str(event or "")


def worker_key(cam_id, event_id=""):
    # Key by the physical camera, NOT the event. Switching the active event
    # (which the dashboard does on every navigation via /context) must not tear
    # down and reopen a running camera — that briefly drops the feed and, for a
    # local/USB webcam, can fail to reopen. The worker's event_id is updated in
    # place by sync_workers_once instead.
    return str(cam_id)


def find_worker(cam_id, event_id=""):
    key = worker_key(str(cam_id), event_id)
    worker = workers.get(key)
    if worker is not None:
        return worker

    matches = [
        candidate
        for candidate in workers.values()
        if candidate.cam_id == str(cam_id)
    ]
    return matches[0] if len(matches) == 1 else None


@app.after_request
def add_cors_headers(response):
    # The dashboard (http://localhost:5173) calls this service cross-origin, so
    # allow it to POST to the control endpoints (test / detection toggle).
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def build_capture_source(camera):
    source = str(camera.get("stream_source", "")).strip()
    stream_type = camera.get("stream_type", "local")

    if stream_type == "mobile":
        return source

    if stream_type == "local" and source.isdigit():
        return int(source)

    username = camera.get("stream_username") or ""
    password = camera.get("stream_password") or ""

    if source.startswith(("rtsp://", "http://", "https://", "rtmp://")):
        if username and password:
            parts = urlsplit(source)
            if "@" not in parts.netloc:
                netloc = f"{username}:{password}@{parts.netloc}"
                return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        return source

    # Bare host[:port][/path] with no scheme: assume the configured stream type.
    auth = f"{username}:{password}@" if username and password else ""
    if stream_type in ("rtsp", "rtmp"):
        return f"{stream_type}://{auth}{source}"
    if stream_type in ("http", "https", "mjpeg"):
        scheme = "http" if stream_type == "mjpeg" else stream_type
        return f"{scheme}://{auth}{source}"

    return source


def is_network_source(source):
    return isinstance(source, str) and source.startswith(
        ("rtsp://", "http://", "https://", "rtmp://")
    )


def detect_stream_type(source):
    """Best-effort guess of the stream type from a raw source string, so a user
    can paste any URL and not have to pick the type by hand."""
    s = str(source).strip()
    if s.isdigit():
        return "local"
    low = s.lower()
    if low.startswith("rtsp://"):
        return "rtsp"
    if low.startswith("rtmp://"):
        return "rtmp"
    if ".m3u8" in low:
        return "hls"
    if any(k in low for k in ("mjpg", "mjpeg", "nphmotionjpeg", "axis-cgi", "/video.cgi")):
        return "mjpeg"
    if low.startswith("mobile:"):
        return "mobile"
    if low.startswith(("http://", "https://")):
        return "http"
    return "local"


def create_capture(source):
    """Open a VideoCapture with the right backend for the source kind.
    Network URLs go through FFMPEG so the RTSP-over-TCP/timeout options apply."""
    if isinstance(source, int):
        capture = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    elif is_network_source(source):
        # Pass open/read timeouts so a stalled network stream makes read() fail
        # fast (the worker then reconnects) instead of blocking forever, which
        # froze the live feed ("stuck"). Properties exist on OpenCV >= 4.5.2.
        params = []
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            params += [int(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC), NETWORK_OPEN_TIMEOUT_MS]
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            params += [int(cv2.CAP_PROP_READ_TIMEOUT_MSEC), NETWORK_READ_TIMEOUT_MS]
        capture = (
            cv2.VideoCapture(source, cv2.CAP_FFMPEG, params)
            if params
            else cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        )
    else:
        capture = cv2.VideoCapture(source)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


def make_tracker():
    return ByteTrackAdapter()


STATIC_CAMERAS_PATH = os.environ.get(
    "VISION_STATIC_CAMERAS",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "cameras_local.json"),
)


def load_static_cameras():
    """Cameras defined in a local JSON file, independent of the backend API.

    Lets the service run standalone (or add extra feeds) without a database
    entry. Returns [] if the file is missing or unreadable.
    """
    if not os.path.exists(STATIC_CAMERAS_PATH):
        return []
    try:
        import json

        with open(STATIC_CAMERAS_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        cameras = data.get("cameras", data) if isinstance(data, dict) else data
        return [cam for cam in cameras if cam.get("enabled", True)]
    except Exception as exc:
        print(f"[WARNING] Could not read static cameras from {STATIC_CAMERAS_PATH}: {exc}")
        return []


def fetch_cameras():
    if REQUIRE_EVENT_CONTEXT and not ACTIVE_EVENT_ID:
        return []

    api_cameras = []
    try:
        params = {"event_id": ACTIVE_EVENT_ID} if ACTIVE_EVENT_ID else None
        response = requests.get(f"{API_BASE_URL}/cameras", params=params, timeout=5)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            api_cameras = payload.get("value") or payload.get("data") or payload.get("cameras") or []
        else:
            api_cameras = payload
        api_cameras = [camera for camera in api_cameras if camera.get("enabled", True)]
    except Exception as exc:
        # Backend down or unreachable: still run whatever is configured locally.
        print(f"[WARNING] Camera API unavailable, using local cameras only: {exc}")

    static_cameras = [] if ACTIVE_EVENT_ID or REQUIRE_EVENT_CONTEXT else load_static_cameras()

    # Merge, with API entries taking precedence over local ones on cam_id clash.
    merged = {str(cam.get("cam_id")): cam for cam in static_cameras}
    merged.update({str(cam.get("cam_id")): cam for cam in api_cameras})
    return list(merged.values())


def update_camera_status(camera, status, error=""):
    camera_id = camera.get("_id")
    if not camera_id:
        return

    try:
        requests.patch(
            f"{API_BASE_URL}/cameras/{camera_id}/status",
            json={"connection_status": status, "last_error": error[:500]},
            timeout=3,
        )
    except Exception as exc:
        print(f"[WARNING] Failed to update camera {camera.get('cam_id')} status: {exc}")


class CameraWorker:
    def __init__(self, camera):
        self.camera = camera
        self.cam_id = str(camera.get("cam_id"))
        self.event_id = get_camera_event_id(camera)
        self.source = build_capture_source(camera)
        self.tracker = make_tracker()
        # Each camera needs its own detector so the per-camera person_list and
        # recognition state stay isolated. A shared instance leaks detections
        # (e.g. a whitelisted person) across every feed. ONNX models are
        # module-level globals, so this only allocates a small per-camera state.
        self.detector = Detections(320, 320, 320, 320)
        self.capture = None
        self.frame = None
        self.frame_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.frame_index = 0
        self.last_error = ""
        self.online = False
        # When False the worker just decodes + re-streams the camera (cheap view,
        # no inference). Toggle at runtime via POST /cameras/<id>/detection.
        self.detection_enabled = bool(camera.get("detection_enabled", True))

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.capture is not None:
            self.capture.release()
        self.thread.join(timeout=3)

    def open_capture(self):
        if self.capture is not None:
            self.capture.release()

        # FFMPEG backend (for network URLs) honours the RTSP-over-TCP and timeout
        # options in OPENCV_FFMPEG_CAPTURE_OPTIONS, so a dead host fails fast.
        self.capture = create_capture(self.source)
        if not self.capture.isOpened():
            raise RuntimeError(f"Could not open stream source: {self.source}")

        self.online = True
        self.last_error = ""
        update_camera_status(self.camera, "online")
        print(f"[INFO] Camera {self.cam_id} online: {self.source}")

    def set_latest_frame(self, frame):
        ok, buffer = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )
        if not ok:
            return

        with self.frame_lock:
            self.frame = buffer.tobytes()

    def get_latest_frame(self):
        with self.frame_lock:
            return self.frame

    def mark_error(self, error):
        self.online = False
        self.last_error = str(error)
        print(f"[WARNING] Camera {self.cam_id} offline: {self.last_error}")
        update_camera_status(self.camera, "error", self.last_error)

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.open_capture()
                read_failures = 0
                last_ok_at = time.time()
                is_net = is_network_source(self.source)

                while not self.stop_event.is_set():
                    ok, frame = self.capture.read()
                    if not ok or frame is None:
                        # Network streams drop occasional frames; treat a sustained
                        # run of failures OR a prolonged stall (a wedged socket read)
                        # as a disconnect. The stall timer is network-only: a local/
                        # USB camera under heavy inference load must NOT be marked
                        # offline just because reads briefly back up.
                        read_failures += 1
                        stalled = is_net and (time.time() - last_ok_at) >= STREAM_STALL_SECONDS
                        if read_failures >= READ_FAIL_LIMIT or stalled:
                            raise RuntimeError("Stream read failed or stalled")
                        time.sleep(0.05)
                        continue
                    read_failures = 0
                    last_ok_at = time.time()

                    self.frame_index += 1

                    # Detection off: stream the raw frame, skip all inference.
                    if not self.detection_enabled:
                        self.set_latest_frame(frame)
                        continue

                    if FRAME_SKIP > 1 and self.frame_index % FRAME_SKIP != 0:
                        self.set_latest_frame(frame)
                        continue

                    try:
                        processed = self.detector.yolo_predictions(
                            frame,
                            self.tracker,
                            self.cam_id,
                            event_id=self.event_id,
                        )
                        self.set_latest_frame(processed)
                    except Exception as exc:
                        # One bad frame / inference error must not bubble up to the
                        # outer handler and force a full camera reconnect (which
                        # drops the feed). Log, stream the raw frame, keep going.
                        self.last_error = str(exc)
                        print(f"[WARNING] Camera {self.cam_id} frame processing failed: {exc}")
                        self.set_latest_frame(frame)

            except Exception as exc:
                self.mark_error(exc)
                if self.capture is not None:
                    self.capture.release()
                time.sleep(RECONNECT_SECONDS)


class MobileCameraWorker:
    def __init__(self, camera):
        self.camera = camera
        self.cam_id = str(camera.get("cam_id"))
        self.event_id = get_camera_event_id(camera)
        self.source = build_capture_source(camera)
        self.tracker = make_tracker()
        self.detector = Detections(320, 320, 320, 320)
        self.frame = None
        self.frame_lock = threading.Lock()
        self.pending_frame = None
        self.pending_lock = threading.Lock()
        self.pending_event = threading.Event()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.frame_index = 0
        self.last_error = ""
        self.online = False
        self.detection_enabled = bool(camera.get("detection_enabled", True))
        self.last_frame_at = 0.0
        self.status_lock = threading.Lock()
        self.current_people = []
        self.recent_events = []
        self.last_event_key = None

    def start(self):
        self.online = True
        self.last_error = "Waiting for phone consent/upload"
        update_camera_status(self.camera, "online", self.last_error)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.pending_event.set()
        self.thread.join(timeout=3)

    def accepts_token(self, token):
        return bool(self.source) and str(token) == str(self.source)

    def submit_jpeg(self, data):
        arr = np.frombuffer(data, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Uploaded frame is not a valid JPEG image")

        with self.pending_lock:
            self.pending_frame = frame
            self.last_frame_at = time.time()
        self.pending_event.set()
        return frame.shape[1], frame.shape[0]

    def set_latest_frame(self, frame):
        ok, buffer = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )
        if not ok:
            return
        with self.frame_lock:
            self.frame = buffer.tobytes()

    def get_latest_frame(self):
        with self.frame_lock:
            return self.frame

    def get_ai_status(self):
        with self.status_lock:
            return {
                "ok": True,
                "cam_id": self.cam_id,
                "online": self.online,
                "detection_enabled": self.detection_enabled,
                "last_error": self.last_error,
                "last_frame_age_seconds": round(max(0.0, time.time() - self.last_frame_at), 2)
                if self.last_frame_at
                else None,
                "current_people": list(self.current_people),
                "recent_events": list(self.recent_events),
            }

    def update_ai_status(self):
        now = time.time()
        people = []

        for person in list(self.detector.person_list):
            last_seen = getattr(person, "last_seen", None)
            if last_seen is not None:
                age = (datetime.datetime.now() - last_seen).total_seconds()
                if age > 8:
                    continue

            status = getattr(person, "last_status", "") or "unclear"
            name = getattr(person, "person_name", "na") or "na"
            confidence = float(getattr(person, "last_confidence", 0.0) or 0.0)
            na_streak = int(getattr(person, "na_streak", 0) or 0)
            if name != "na" and (
                na_streak >= MOBILE_STALE_IDENTITY_NA_STREAK
                or confidence <= RECOGNITION_RELEASE_THRESHOLD
            ):
                name = "na"
                status = "unclear"
                confidence = 0.0

            if name == "na":
                display_name = "Unknown"
                access = "Needs Review"
            elif status == "whitelisted":
                display_name = name
                access = "Allowed"
            elif status == "notwhitelisted":
                display_name = name
                access = "Restricted"
            else:
                display_name = name
                access = "Needs Review"

            people.append({
                "track_id": int(getattr(person, "person_id", 0) or 0),
                "name": display_name,
                "raw_name": name,
                "status": status,
                "access": access,
                "confidence": round(confidence, 3),
                "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
            })

        people.sort(key=lambda item: item["confidence"], reverse=True)

        with self.status_lock:
            self.current_people = people
            if people:
                top = people[0]
                event_key = (
                    top["track_id"],
                    top["raw_name"],
                    top["status"],
                )
                if event_key != self.last_event_key:
                    self.last_event_key = event_key
                    self.recent_events.insert(0, top)
                    self.recent_events = self.recent_events[:8]
            else:
                self.last_event_key = None

    def run(self):
        print(f"[INFO] Mobile camera {self.cam_id} waiting for consented browser frames")
        while not self.stop_event.is_set():
            self.pending_event.wait(timeout=1)
            self.pending_event.clear()
            if self.stop_event.is_set():
                break

            with self.pending_lock:
                frame = self.pending_frame
                self.pending_frame = None

            if frame is None:
                continue

            self.online = True
            self.last_error = ""
            self.frame_index += 1
            if not self.detection_enabled:
                self.set_latest_frame(frame)
                continue
            if FRAME_SKIP > 1 and self.frame_index % FRAME_SKIP != 0:
                self.set_latest_frame(frame)
                continue

            try:
                processed = self.detector.yolo_predictions(
                    frame,
                    self.tracker,
                    self.cam_id,
                    event_id=self.event_id,
                )
                self.set_latest_frame(processed)
                self.update_ai_status()
            except Exception as exc:
                # A single bad frame / inference error must never kill this worker
                # thread — that froze the mobile feed permanently (e.g. a log line
                # with an emoji raising UnicodeEncodeError on a cp1252 console).
                # Log it, fall back to the raw frame, and keep processing.
                self.last_error = str(exc)
                print(f"[WARNING] Mobile camera {self.cam_id} frame processing failed: {exc}")
                self.set_latest_frame(frame)


def sync_workers_once():
    cameras = fetch_cameras()
    desired = {
        worker_key(str(camera.get("cam_id")), get_camera_event_id(camera)): camera
        for camera in cameras
    }

    with workers_lock:
        for key in list(workers.keys()):
            if key not in desired:
                print(f"[INFO] Stopping camera worker {key}")
                workers.pop(key).stop()

        for key, camera in desired.items():
            cam_id = str(camera.get("cam_id"))
            current = workers.get(key)
            source = build_capture_source(camera)
            if current and current.source == source:
                current.camera = camera
                current.event_id = get_camera_event_id(camera)
                continue

            if current:
                print(f"[INFO] Restarting camera worker {key}")
                current.stop()

            print(f"[INFO] Starting camera worker {key}")
            if camera.get("stream_type") == "mobile":
                worker = MobileCameraWorker(camera)
            else:
                worker = CameraWorker(camera)
            workers[key] = worker
            worker.start()


def trigger_worker_sync():
    def run_sync():
        if not sync_trigger_lock.acquire(blocking=False):
            return
        try:
            sync_workers_once()
        finally:
            sync_trigger_lock.release()

    threading.Thread(target=run_sync, daemon=True).start()


def ensure_event_context(event_id, sync=True):
    """Point the service at `event_id` and bring its camera workers up.

    The mobile checkpoint page is opened directly on a phone, not through the
    React dashboard, so it can't rely on the dashboard POSTing /context first.
    Without this, fetch_cameras() returns nothing (REQUIRE_EVENT_CONTEXT with an
    empty ACTIVE_EVENT_ID) and the phone's frame uploads keep hitting "No mobile
    camera worker" until the user re-opens the event on the dashboard. With
    sync=True the worker sync runs inline so the caller can retry the worker
    lookup in the same request; otherwise it is kicked off in the background.
    """
    global ACTIVE_EVENT_ID
    event_id = str(event_id or "").strip()
    if not event_id:
        return
    changed = event_id != ACTIVE_EVENT_ID
    if changed:
        ACTIVE_EVENT_ID = event_id
        print(f"[INFO] Event context set to {event_id} from mobile checkpoint request")
    if sync:
        with sync_trigger_lock:
            sync_workers_once()
    elif changed:
        trigger_worker_sync()


def find_mobile_worker_or_sync(cam_id, event_id):
    """Find the mobile worker, self-healing the event context if it's missing.

    If no worker exists yet but the request carries an event_id, establish that
    event's context, sync workers inline, and retry the lookup once. This lets a
    freshly opened phone page work even if the dashboard never posted /context.
    """
    with workers_lock:
        worker = find_worker(str(cam_id), event_id)
    if (worker is None or not isinstance(worker, MobileCameraWorker)) and event_id:
        ensure_event_context(event_id, sync=True)
        with workers_lock:
            worker = find_worker(str(cam_id), event_id)
    return worker


def worker_sync_loop():
    while True:
        try:
            sync_workers_once()
        except Exception as exc:
            print(f"[WARNING] Camera sync failed: {exc}")
        time.sleep(CAMERA_POLL_SECONDS)


def mjpeg_stream(cam_id, event_id=""):
    while True:
        with workers_lock:
            worker = find_worker(str(cam_id), event_id)

        if worker is None:
            time.sleep(1)
            continue

        frame = worker.get_latest_frame()
        if frame is None:
            time.sleep(0.1)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        )
        time.sleep(0.03)


@app.route("/health")
def health():
    with workers_lock:
        camera_status = {
            key: {
                "cam_id": worker.cam_id,
                "event_id": worker.event_id,
                "online": worker.online,
                "source": str(worker.source),
                "last_error": worker.last_error,
                "detection_enabled": worker.detection_enabled,
            }
            for key, worker in workers.items()
        }
    return jsonify({"ok": True, "event_id": ACTIVE_EVENT_ID, "cameras": camera_status})


@app.route("/context", methods=["GET", "POST", "OPTIONS"])
def context():
    global ACTIVE_EVENT_ID

    if request.method == "OPTIONS":
        return jsonify({"ok": True})

    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        new_event = str(data.get("event_id") or "").strip()
        # The dashboard POSTs /context on every Live-page mount. Only re-sync the
        # workers when the active event ACTUALLY changes — otherwise we needlessly
        # tear down and reopen every camera (which drops the local webcam feed)
        # on each navigation.
        if new_event != ACTIVE_EVENT_ID:
            ACTIVE_EVENT_ID = new_event
            trigger_worker_sync()

    return jsonify({"ok": True, "event_id": ACTIVE_EVENT_ID})


@app.route("/cameras/<cam_id>/detection", methods=["POST", "GET"])
def toggle_detection(cam_id):
    event_id = request.args.get("event_id", "")
    with workers_lock:
        worker = find_worker(str(cam_id), event_id)

    if worker is None:
        return jsonify({"ok": False, "error": f"No active worker for camera {cam_id}"}), 404

    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        if "enabled" not in data:
            return jsonify({"ok": False, "error": "Body must include 'enabled' (true/false)"}), 400
        worker.detection_enabled = bool(data["enabled"])
        state = "ON" if worker.detection_enabled else "OFF"
        print(f"[INFO] Camera {cam_id} detection {state}")

    return jsonify({
        "ok": True,
        "cam_id": str(cam_id),
        "detection_enabled": worker.detection_enabled,
    })


@app.route("/video_feed/<cam_id>")
def video_feed(cam_id):
    event_id = request.args.get("event_id", "")
    return Response(
        mjpeg_stream(cam_id, event_id=event_id),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.route("/mobile_camera/<cam_id>")
def mobile_camera_page(cam_id):
    token = request.args.get("token", "")
    event_id = request.args.get("event_id", "")
    # Establish event context straight from the mobile link so the worker is
    # coming up by the time the phone starts uploading frames — don't wait for
    # the dashboard to POST /context.
    ensure_event_context(event_id, sync=False)
    escaped_cam = html.escape(str(cam_id), quote=True)
    escaped_token = html.escape(token, quote=True)
    escaped_event = html.escape(event_id, quote=True)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mobile Camera {escaped_cam}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #f4f6f8; color: #111111; -webkit-font-smoothing: antialiased; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 14px; }}
    .topbar {{ display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: end; min-height: 132px; margin-bottom: 12px; padding: 18px; border: 1px solid #111111; background: #111111; color: #ffffff; }}
    .brand {{ color: #18d97d; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; }}
    h1 {{ max-width: 560px; margin: 10px 0 8px; font-size: clamp(1.8rem, 7vw, 3.4rem); font-weight: 900; line-height: 0.95; }}
    .checkpoint {{ color: #d6d6d6; font-size: 0.9rem; font-weight: 700; }}
    .pill {{ min-height: 32px; display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid rgba(255,255,255,0.28); color: #ffffff; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }}
    .consent-note {{ margin: 0 0 12px; padding: 12px 14px; border: 1px solid #d9d9d9; background: #ffffff; color: #555555; font-size: 0.92rem; line-height: 1.55; }}
    .consent-note strong {{ color: #111111; }}
    .grid {{ display: grid; grid-template-columns: 1fr; gap: 12px; }}
    .panel {{ border: 1px solid #d9d9d9; background: #ffffff; padding: 12px; }}
    video, .ai-feed {{ width: 100%; background: #111111; display: block; aspect-ratio: 16 / 9; object-fit: cover; }}
    .label {{ color: #555555; font-size: 0.72rem; font-weight: 900; text-transform: uppercase; margin: 0 0 8px; letter-spacing: 0.08em; }}
    button {{ min-height: 46px; border: 1px solid #111111; border-radius: 0; padding: 0 12px; font: inherit; font-size: 0.9rem; font-weight: 900; cursor: pointer; }}
    button:disabled {{ cursor: not-allowed; opacity: 0.45; }}
    .controls {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }}
    .start {{ border-color: #18d97d; background: #18d97d; color: #111111; }}
    .stop {{ border-color: #b91c1c; background: #b91c1c; color: #ffffff; }}
    .switch {{ background: #ffffff; color: #111111; }}
    .muted {{ color: #555555; line-height: 1.5; }}
    .status {{ margin-top: 10px; padding: 10px; border: 1px solid #d9d9d9; background: #f7f7f7; color: #555555; font-size: 0.86rem; line-height: 1.45; }}
    .access-card {{ display: grid; gap: 8px; }}
    .name {{ color: #111111; font-size: 1.45rem; font-weight: 900; line-height: 1.08; }}
    .access {{ display: inline-flex; width: fit-content; min-height: 30px; align-items: center; padding: 0 10px; border: 1px solid #d9d9d9; font-size: 0.76rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }}
    .allowed {{ border-color: #18d97d; background: rgba(24,217,125,0.16); color: #0f6b41; }}
    .restricted {{ border-color: #b91c1c; background: #fee2e2; color: #991b1b; }}
    .review {{ border-color: #d9d9d9; background: #f7f7f7; color: #555555; }}
    .metric {{ color: #555555; font-size: 0.9rem; }}
    .recent {{ display: grid; gap: 8px; margin-top: 8px; }}
    .event {{ display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #eeeeee; background: #f7f7f7; color: #111111; font-size: 0.88rem; }}
    @media (min-width: 760px) {{ main {{ padding: 18px; }} .grid {{ grid-template-columns: 1.1fr 0.9fr; }} .controls {{ grid-template-columns: repeat(3, 1fr); }} }}
    @media (max-width: 520px) {{ .topbar {{ grid-template-columns: 1fr; min-height: auto; }} .pill {{ width: fit-content; }} }}
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div>
        <div class="brand">PULAO</div>
        <h1>Mobile Checkpoint</h1>
        <div class="checkpoint">Camera {escaped_cam}</div>
      </div>
      <div class="pill" id="connectionPill">Waiting</div>
    </div>
    <p class="consent-note">
      <strong>Consent controlled.</strong> This phone streams only after Start Camera is pressed and the browser camera permission is approved.
      Closing this page or pressing Stop ends the upload.
    </p>
    <div class="grid">
      <section class="panel">
        <p class="label">Phone Camera</p>
        <video id="preview" autoplay playsinline muted></video>
        <div class="controls">
          <button class="start" id="startBtn">Start Camera</button>
          <button class="switch" id="switchBtn" disabled>Flip</button>
          <button class="stop" id="stopBtn" disabled>Stop</button>
        </div>
        <div class="status" id="status">Idle. Camera permission has not been requested.</div>
      </section>
      <section class="panel">
        <p class="label">AI Checkpoint</p>
        <div class="access-card">
          <div class="name" id="currentName">No person detected</div>
          <div class="access review" id="accessBadge">Waiting</div>
          <div class="metric" id="confidenceText">Confidence: --</div>
          <div class="metric" id="frameText">Last frame: --</div>
        </div>
        <p class="label" style="margin-top:14px;">Processed Preview</p>
        <img class="ai-feed" id="aiFeed" src="/video_feed/{escaped_cam}?event_id={escaped_event}" alt="Processed AI feed" />
      </section>
      <section class="panel" style="grid-column: 1 / -1;">
        <p class="label">Recent Detections</p>
        <div class="recent" id="recentList"><div class="event"><span>No detections yet</span><span>--</span></div></div>
      </section>
    </div>
  </main>
  <canvas id="canvas" style="display:none"></canvas>
  <script>
    const camId = {escaped_cam!r};
    const token = {escaped_token!r};
    const eventId = {escaped_event!r};
    const video = document.getElementById('preview');
    const canvas = document.getElementById('canvas');
    const statusEl = document.getElementById('status');
    const connectionPill = document.getElementById('connectionPill');
    const currentName = document.getElementById('currentName');
    const accessBadge = document.getElementById('accessBadge');
    const confidenceText = document.getElementById('confidenceText');
    const frameText = document.getElementById('frameText');
    const recentList = document.getElementById('recentList');
    const startBtn = document.getElementById('startBtn');
    const switchBtn = document.getElementById('switchBtn');
    const stopBtn = document.getElementById('stopBtn');
    let stream = null;
    let timer = null;
    let statusTimer = null;
    let inFlight = false;
    let facingMode = 'environment';

    function setStatus(text) {{ statusEl.textContent = text; }}

    function accessClass(access) {{
      if (access === 'Allowed') return 'access allowed';
      if (access === 'Restricted') return 'access restricted';
      return 'access review';
    }}

    function escapeHtml(value) {{
      return String(value || '').replace(/[&<>"']/g, (char) => ({{
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }}[char]));
    }}

    function renderStatus(data) {{
      connectionPill.textContent = data.last_frame_age_seconds == null ? 'Waiting' : 'Streaming';
      frameText.textContent = data.last_frame_age_seconds == null
        ? 'Last frame: --'
        : `Last frame: ${{data.last_frame_age_seconds}}s ago`;

      const people = data.current_people || [];
      if (people.length > 0) {{
        const top = people[0];
        currentName.textContent = top.name || 'Unknown';
        accessBadge.textContent = top.access || 'Needs Review';
        accessBadge.className = accessClass(top.access);
        confidenceText.textContent = `Confidence: ${{Math.round((top.confidence || 0) * 100)}}%`;
      }} else {{
        currentName.textContent = 'No person detected';
        accessBadge.textContent = 'Waiting';
        accessBadge.className = 'access review';
        confidenceText.textContent = 'Confidence: --';
      }}

      const events = data.recent_events || [];
      if (events.length === 0) {{
        recentList.innerHTML = '<div class="event"><span>No detections yet</span><span>--</span></div>';
      }} else {{
        recentList.innerHTML = events.map((event) => {{
          const time = event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], {{hour: '2-digit', minute: '2-digit', second: '2-digit'}}) : '--';
          const name = escapeHtml(event.name || 'Unknown');
          const access = escapeHtml(event.access || 'Needs Review');
          return `<div class="event"><span>${{name}}</span><span>${{access}} - ${{time}}</span></div>`;
        }}).join('');
      }}
    }}

    async function pollStatus() {{
      try {{
        const response = await fetch(`/mobile_camera/${{encodeURIComponent(camId)}}/status?token=${{encodeURIComponent(token)}}&event_id=${{encodeURIComponent(eventId)}}`);
        const data = await response.json();
        if (data.ok) renderStatus(data);
      }} catch (err) {{
        connectionPill.textContent = 'Offline';
      }}
    }}

    async function uploadFrame() {{
      if (!stream || inFlight || video.videoWidth === 0 || document.hidden) return;
      inFlight = true;
      const maxWidth = 720;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {{
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {{
          const response = await fetch(`/mobile_camera/${{encodeURIComponent(camId)}}/frame?token=${{encodeURIComponent(token)}}&event_id=${{encodeURIComponent(eventId)}}`, {{
            method: 'POST',
            headers: {{ 'Content-Type': 'image/jpeg' }},
            body: blob,
            signal: controller.signal,
          }});
          const data = await response.json();
          setStatus(data.ok ? `Streaming with consent. Last frame: ${{data.width}}x${{data.height}}` : `${{data.error}}${{data.hint ? ' — ' + data.hint : ''}}`);
        }} catch (err) {{
          setStatus(`Upload failed: ${{err.message}}`);
        }} finally {{
          clearTimeout(timeoutId);
          inFlight = false;
        }}
      }}, 'image/jpeg', 0.65);
    }}

    async function startCamera() {{
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {{
        setStatus('Camera access is unavailable because this page is not running in a secure browser context. Open the HTTPS mobile link and accept the certificate warning.');
        return;
      }}
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {{
        setStatus('Camera permission requires HTTPS on mobile browsers. Open the HTTPS mobile link.');
        return;
      }}
      try {{
        stopCamera(false);
        stream = await navigator.mediaDevices.getUserMedia({{
          video: {{ facingMode, width: {{ ideal: 960 }}, height: {{ ideal: 540 }} }},
          audio: false,
        }});
        video.srcObject = stream;
        startBtn.disabled = true;
        switchBtn.disabled = false;
        stopBtn.disabled = false;
        setStatus('Camera permission granted. Uploading frames...');
        timer = setInterval(uploadFrame, 500);
        if (!statusTimer) statusTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }} catch (err) {{
        setStatus(`Camera permission denied or unavailable: ${{err.message}}`);
      }}
    }}

    function stopCamera(updateStatus = true) {{
      if (timer) clearInterval(timer);
      timer = null;
      if (statusTimer) clearInterval(statusTimer);
      statusTimer = null;
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
      startBtn.disabled = false;
      switchBtn.disabled = true;
      stopBtn.disabled = true;
      if (updateStatus) setStatus('Stopped. No frames are being uploaded.');
    }}

    startBtn.onclick = startCamera;
    switchBtn.onclick = async () => {{
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
      setStatus(`Switching to ${{facingMode === 'environment' ? 'back' : 'front'}} camera...`);
      await startCamera();
    }};
    stopBtn.onclick = () => stopCamera(true);
  </script>
</body>
</html>"""


@app.route("/mobile_camera/<cam_id>/frame", methods=["POST", "OPTIONS"])
def mobile_camera_frame(cam_id):
    if request.method == "OPTIONS":
        return jsonify({"ok": True})

    token = request.args.get("token", "")
    event_id = request.args.get("event_id", "")
    worker = find_mobile_worker_or_sync(cam_id, event_id)

    if worker is None or not isinstance(worker, MobileCameraWorker):
        return jsonify({
            "ok": False,
            "error": f"No mobile camera worker for {cam_id}",
            "hint": "Event is still syncing or this camera isn't enabled for the event.",
        }), 404
    if not worker.accepts_token(token):
        return jsonify({"ok": False, "error": "Invalid or missing consent token"}), 403

    data = request.get_data()
    if not data:
        return jsonify({"ok": False, "error": "Empty frame upload"}), 400

    try:
        width, height = worker.submit_jpeg(data)
        return jsonify({"ok": True, "cam_id": str(cam_id), "width": width, "height": height})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/mobile_camera/<cam_id>/status")
def mobile_camera_status(cam_id):
    token = request.args.get("token", "")
    event_id = request.args.get("event_id", "")
    worker = find_mobile_worker_or_sync(cam_id, event_id)

    if worker is None or not isinstance(worker, MobileCameraWorker):
        return jsonify({"ok": False, "error": f"No mobile camera worker for {cam_id}"}), 404
    if not worker.accepts_token(token):
        return jsonify({"ok": False, "error": "Invalid or missing consent token"}), 403

    return jsonify(worker.get_ai_status())


@app.route("/cameras/test", methods=["POST"])
def test_camera():
    """Validate a stream before saving it.

    Body: {stream_source, stream_type?, stream_username?, stream_password?,
           thumbnail?}. stream_type is auto-detected when omitted. Returns the
    resolution/FPS plus a small base64 preview so the UI can confirm the feed.
    """
    data = request.get_json(force=True, silent=True) or {}
    raw_source = str(data.get("stream_source", "")).strip()
    if not raw_source:
        return jsonify({"ok": False, "error": "stream_source is required"}), 400

    stream_type = data.get("stream_type") or detect_stream_type(raw_source)
    camera = {
        "stream_source": raw_source,
        "stream_type": stream_type,
        "stream_username": data.get("stream_username", ""),
        "stream_password": data.get("stream_password", ""),
    }
    source = build_capture_source(camera)
    want_thumb = data.get("thumbnail", True)

    capture = None
    try:
        # Public/network cameras often refuse the first connection (throttling,
        # cold start), so retry opening within the timeout budget rather than
        # failing on the first attempt.
        frame = None
        reason = "Could not open stream (bad URL, offline, or wrong credentials)."
        deadline = time.time() + TEST_READ_TIMEOUT
        while time.time() < deadline and frame is None:
            capture = create_capture(source)
            if capture.isOpened():
                ok, candidate = capture.read()
                if ok and candidate is not None:
                    frame = candidate
                    break
                reason = "Connected but no frame received before timeout."
            capture.release()
            capture = None
            time.sleep(0.3)

        if frame is None:
            return jsonify({"ok": False, "stream_type": stream_type, "error": reason})

        height, width = frame.shape[:2]
        fps = capture.get(cv2.CAP_PROP_FPS) or 0.0

        thumbnail = None
        if want_thumb:
            scale = 320.0 / max(1, width)
            preview = (
                cv2.resize(frame, (int(width * scale), int(height * scale)))
                if scale < 1
                else frame
            )
            ok, buffer = cv2.imencode(
                ".jpg", preview, [int(cv2.IMWRITE_JPEG_QUALITY), 70]
            )
            if ok:
                thumbnail = "data:image/jpeg;base64," + base64.b64encode(
                    buffer
                ).decode("ascii")

        return jsonify({
            "ok": True,
            "stream_type": stream_type,
            "width": int(width),
            "height": int(height),
            "fps": round(float(fps), 2),
            "thumbnail": thumbnail,
        })
    except Exception as exc:
        return jsonify({"ok": False, "stream_type": stream_type, "error": str(exc)})
    finally:
        if capture is not None:
            capture.release()


@app.route("/cameras/reload", methods=["POST"])
def reload_cameras():
    sync_workers_once()
    return jsonify({"ok": True, "count": len(workers)})


def run_http_server():
    if USE_WAITRESS:
        try:
            from waitress import serve

            print(f"[INFO] Waitress vision server running on http://{SERVICE_HOST}:{SERVICE_PORT}")
            serve(app, host=SERVICE_HOST, port=SERVICE_PORT, threads=16)
            return
        except ImportError:
            print("[WARNING] waitress is not installed. Falling back to Flask dev server.")

    app.run(host=SERVICE_HOST, port=SERVICE_PORT, threaded=True)


if __name__ == "__main__":
    threading.Thread(target=worker_sync_loop, daemon=True).start()
    if ENABLE_HTTPS:
        threading.Thread(
            target=lambda: app.run(
                host=SERVICE_HOST,
                port=SERVICE_HTTPS_PORT,
                threaded=True,
                ssl_context="adhoc",
            ),
            daemon=True,
        ).start()
        print(f"[INFO] HTTPS mobile consent server running on port {SERVICE_HTTPS_PORT}")
    run_http_server()
