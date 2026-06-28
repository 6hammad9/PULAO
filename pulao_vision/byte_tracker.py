import itertools
import os
from dataclasses import dataclass

import numpy as np
from scipy.optimize import linear_sum_assignment


def _bbox_from_detection(detection):
    points = detection.points.astype(float)
    return np.array([points[0, 0], points[0, 1], points[1, 0], points[1, 1]], dtype=float)


def _points_from_bbox(bbox):
    return np.array([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], dtype=float)


def _score_from_detection(detection):
    if getattr(detection, "data", None) and "score" in detection.data:
        return float(detection.data["score"])
    if getattr(detection, "scores", None) is not None and len(detection.scores) > 0:
        return float(np.nanmean(detection.scores))
    return 1.0


def _embedding_from_detection(detection):
    emb = getattr(detection, "embedding", None)
    if emb is None:
        return None
    return np.asarray(emb, dtype=np.float64).ravel()


def _track_embedding(track):
    """Most recent usable appearance histogram for a track."""
    emb = _embedding_from_detection(track.last_detection)
    if emb is not None:
        return emb
    for detection in reversed(track.past_detections):
        emb = _embedding_from_detection(detection)
        if emb is not None:
            return emb
    return None


def _appearance_similarity(emb_a, emb_b):
    """Pearson correlation between two histograms (matches cv2 HISTCMP_CORREL).

    Returns 1.0 when appearance cannot be compared, so matching falls back to
    IoU-only behaviour instead of wrongly rejecting a match.
    """
    if emb_a is None or emb_b is None or emb_a.shape != emb_b.shape:
        return 1.0
    a = emb_a - emb_a.mean()
    b = emb_b - emb_b.mean()
    denom = np.sqrt(np.sum(a * a) * np.sum(b * b))
    if denom == 0:
        return 1.0
    return float(np.sum(a * b) / denom)


def _iou_matrix(track_bboxes, detection_bboxes):
    if len(track_bboxes) == 0 or len(detection_bboxes) == 0:
        return np.zeros((len(track_bboxes), len(detection_bboxes)), dtype=float)

    tracks = np.asarray(track_bboxes, dtype=float)
    dets = np.asarray(detection_bboxes, dtype=float)

    x_a = np.maximum(tracks[:, None, 0], dets[None, :, 0])
    y_a = np.maximum(tracks[:, None, 1], dets[None, :, 1])
    x_b = np.minimum(tracks[:, None, 2], dets[None, :, 2])
    y_b = np.minimum(tracks[:, None, 3], dets[None, :, 3])

    inter_w = np.maximum(0.0, x_b - x_a)
    inter_h = np.maximum(0.0, y_b - y_a)
    inter = inter_w * inter_h

    track_area = np.maximum(0.0, tracks[:, 2] - tracks[:, 0]) * np.maximum(0.0, tracks[:, 3] - tracks[:, 1])
    det_area = np.maximum(0.0, dets[:, 2] - dets[:, 0]) * np.maximum(0.0, dets[:, 3] - dets[:, 1])
    union = track_area[:, None] + det_area[None, :] - inter
    return np.divide(inter, union, out=np.zeros_like(inter), where=union > 0)


@dataclass
class ByteTrackConfig:
    high_thresh: float = float(os.environ.get("BYTETRACK_HIGH_THRESH", "0.25"))
    low_thresh: float = float(os.environ.get("BYTETRACK_LOW_THRESH", "0.05"))
    new_track_thresh: float = float(os.environ.get("BYTETRACK_NEW_TRACK_THRESH", "0.25"))
    match_thresh: float = float(os.environ.get("BYTETRACK_MATCH_THRESH", "0.30"))
    track_buffer: int = int(os.environ.get("BYTETRACK_TRACK_BUFFER", "45"))
    min_hits: int = int(os.environ.get("BYTETRACK_MIN_HITS", "1"))
    # Appearance gate: reject an IoU match when the body histograms are too
    # dissimilar, so a different person stepping into a vacated spot does not
    # inherit the previous track's ID. Correlation is in [-1, 1]; a match needs
    # similarity >= appearance_thresh. Set BYTETRACK_APPEARANCE_GATE=0 to disable.
    #
    # IMPORTANT: the gate only applies when a track is being re-claimed after a
    # gap of more than appearance_gate_after frames. Continuous frame-to-frame
    # tracking is never gated, otherwise noisy histograms fragment a stable
    # track into a new ID every frame.
    appearance_gate: bool = os.environ.get("BYTETRACK_APPEARANCE_GATE", "1") != "0"
    appearance_thresh: float = float(os.environ.get("BYTETRACK_APPEARANCE_THRESH", "0.20"))
    appearance_gate_after: int = int(os.environ.get("BYTETRACK_APPEARANCE_GATE_AFTER", "5"))


class ByteTrackedObject:
    _ids = itertools.count(1)

    def __init__(self, detection):
        self.id = next(self._ids)
        self.hits = 1
        self.age = 1
        self.time_since_update = 0
        self.score = _score_from_detection(detection)
        self.bbox = _bbox_from_detection(detection)
        self.label = getattr(detection, "label", None)
        self.last_detection = detection
        self.past_detections = [detection]

    @property
    def estimate(self):
        return _points_from_bbox(self.bbox)

    def update(self, detection):
        self.hits += 1
        self.time_since_update = 0
        self.score = _score_from_detection(detection)
        self.bbox = _bbox_from_detection(detection)
        self.label = getattr(detection, "label", None)
        self.last_detection = detection
        self.past_detections.append(detection)
        if len(self.past_detections) > 20:
            self.past_detections.pop(0)

    def mark_missed(self):
        self.age += 1
        self.time_since_update += 1


class ByteTrackAdapter:
    """ByteTrack-style two-stage IoU tracker with Norfair-compatible output."""

    def __init__(self, config=None):
        self.config = config or ByteTrackConfig()
        self.tracks = []

    def update(self, detections=None, **_kwargs):
        detections = list(detections or [])
        for track in self.tracks:
            track.mark_missed()

        scored = [(_score_from_detection(det), det) for det in detections]
        high_dets = [det for score, det in scored if score >= self.config.high_thresh]
        low_dets = [
            det
            for score, det in scored
            if self.config.low_thresh <= score < self.config.high_thresh
        ]

        unmatched_tracks = list(range(len(self.tracks)))
        unmatched_high = self._match(unmatched_tracks, high_dets)
        unmatched_track_indices = unmatched_high[0]
        unmatched_high_indices = unmatched_high[1]

        low_match = self._match(unmatched_track_indices, low_dets)
        unmatched_track_indices = low_match[0]

        for det_idx in unmatched_high_indices:
            detection = high_dets[det_idx]
            if _score_from_detection(detection) >= self.config.new_track_thresh:
                self.tracks.append(ByteTrackedObject(detection))

        self.tracks = [
            track
            for track in self.tracks
            if track.time_since_update <= self.config.track_buffer
        ]

        return [
            track
            for track in self.tracks
            if track.time_since_update == 0 and track.hits >= self.config.min_hits
        ]

    def _match(self, track_indices, detections):
        if not track_indices or not detections:
            return track_indices, list(range(len(detections)))

        track_bboxes = [self.tracks[idx].bbox for idx in track_indices]
        detection_bboxes = [_bbox_from_detection(det) for det in detections]
        ious = _iou_matrix(track_bboxes, detection_bboxes)
        costs = 1.0 - ious

        rows, cols = linear_sum_assignment(costs)
        matched_tracks = set()
        matched_detections = set()

        for row, col in zip(rows, cols):
            if ious[row, col] < self.config.match_thresh:
                continue
            track_idx = track_indices[row]
            track = self.tracks[track_idx]
            # Only second-guess a match when the track has been missing long
            # enough that a *different* person could have entered the spot.
            # Continuous tracking (time_since_update == 1 here) is never gated,
            # so a stable track does not fragment on noisy frame-to-frame
            # histograms.
            if (
                self.config.appearance_gate
                and track.time_since_update > self.config.appearance_gate_after
            ):
                similarity = _appearance_similarity(
                    _track_embedding(track),
                    _embedding_from_detection(detections[col]),
                )
                if similarity < self.config.appearance_thresh:
                    # Same location, different-looking body: refuse to hand the
                    # ID over so the newcomer becomes a fresh track instead.
                    continue
            self.tracks[track_idx].update(detections[col])
            matched_tracks.add(track_idx)
            matched_detections.add(col)

        unmatched_tracks = [idx for idx in track_indices if idx not in matched_tracks]
        unmatched_detections = [
            idx for idx in range(len(detections)) if idx not in matched_detections
        ]
        return unmatched_tracks, unmatched_detections
