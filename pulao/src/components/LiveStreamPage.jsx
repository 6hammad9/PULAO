import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import '../styles/LiveStreamPage.css';
import { apiPath, visionBaseForCamera, VISION_BASE_URL } from '../config/api';

const LiveStreamPage = () => {
  const { eventId } = useParams();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullscreenCamera, setFullscreenCamera] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detecting, setDetecting] = useState({});
  const [toggling, setToggling] = useState({});

  const visionBase = (camera) => visionBaseForCamera(camera);
  const streamSrc = (camera) => `${camera.streamUrl}${camera.streamUrl.includes('?') ? '&' : '?'}t=${refreshKey}`;

  useEffect(() => {
    fetchCameras();
  }, [eventId]);

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const response = await axios.get(apiPath('/api/cameras'), { params: { event_id: eventId } });
      const camerasWithStreams = response.data.map((camera) => ({
        ...camera,
        streamUrl: `${visionBaseForCamera(camera)}/video_feed/${camera.cam_id}?event_id=${eventId}`,
      }));
      setCameras(camerasWithStreams);
      setError('');
      await setVisionContext(camerasWithStreams);
      seedDetectionStates(camerasWithStreams);
    } catch (err) {
      console.error('Failed to fetch cameras:', err);
      setError('System is offline. Unable to load checkpoint configurations.');
    } finally {
      setLoading(false);
    }
  };

  const setVisionContext = async (cameraList) => {
    const bases = cameraList.length > 0
      ? [...new Set(cameraList.map(visionBase))]
      : [VISION_BASE_URL];
    await Promise.all(
      bases.map(async (base) => {
        try {
          await axios.post(`${base}/context`, { event_id: eventId }, { timeout: 5000 });
        } catch {
          // The stream cards will show offline if the vision service is not up.
        }
      })
    );
  };

  const seedDetectionStates = async (cameraList) => {
    const bases = [...new Set(cameraList.map(visionBase))];
    const states = {};
    await Promise.all(
      bases.map(async (base) => {
        try {
          const { data } = await axios.get(`${base}/health`, { timeout: 4000 });
          Object.entries(data?.cameras || {}).forEach(([camId, info]) => {
            states[info.cam_id || camId] = info.detection_enabled !== false;
          });
        } catch {
          // Vision service may be offline; leave state unknown.
        }
      })
    );
    setDetecting((prev) => ({ ...prev, ...states }));
  };

  const toggleDetection = async (camera) => {
    const camId = camera.cam_id;
    const next = !detecting[camId];
    setToggling((state) => ({ ...state, [camId]: true }));
    try {
      const { data } = await axios.post(
        `${visionBase(camera)}/cameras/${camId}/detection?event_id=${eventId}`,
        { enabled: next },
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (data?.ok) {
        setDetecting((state) => ({ ...state, [camId]: data.detection_enabled }));
      }
    } catch (err) {
      console.error(`Failed to toggle detection for camera ${camId}:`, err);
      alert('Could not reach the vision service to toggle detection.');
    } finally {
      setToggling((state) => ({ ...state, [camId]: false }));
    }
  };

  const handleRefresh = () => setRefreshKey((prev) => prev + 1);

  return (
    <div className="live-stream-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">Real-time access control</span>
          <h1>Live Operations</h1>
          <p>Monitor every fixed, IP, and mobile checkpoint with detection controls in one view.</p>
        </div>
        <div className="page-actions">
          <span className="stream-count-badge">{cameras.length} Active Checkpoints</span>
          <button onClick={handleRefresh} className="btn btn-secondary">Refresh Streams</button>
        </div>
      </div>

      {loading && <div className="loading-spinner"><div className="spinner"></div></div>}

      {error && (
        <div className="alert alert-danger">
          <strong>Connection Error:</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <div className="live-grid">
          {cameras.length > 0 ? (
            cameras.map((camera) => (
              <div key={camera._id} className="stream-card">
                <div className="video-wrapper">
                  <div className="live-indicator">
                    <div className="pulsing-dot"></div> LIVE
                  </div>

                  {detecting[camera.cam_id] && <div className="detecting-badge">DETECTING</div>}

                  <img
                    src={streamSrc(camera)}
                    alt={`Live feed ${camera.camera_name}`}
                    className="live-feed"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />

                  <div className="offline-indicator" style={{ display: 'none' }}>
                    <span style={{ fontSize: '2rem' }}>Offline</span>
                    <p style={{ marginTop: '0.5rem' }}>Signal lost</p>
                    <small>Check connection</small>
                  </div>

                  <div className="stream-controls">
                    <button className="control-btn" title="Fullscreen" onClick={() => setFullscreenCamera(camera)}>
                      Full
                    </button>
                  </div>
                </div>

                <div className="stream-info">
                  <div className="info-text">
                    <h3>{camera.camera_name}</h3>
                    <p>ID: {camera.cam_id} · {camera.stream_type || 'local'}</p>
                  </div>
                  <div className="stream-meta">
                    <button
                      className="detection-toggle"
                      disabled={toggling[camera.cam_id]}
                      onClick={() => toggleDetection(camera)}
                      title="Turn person and face detection on or off for this checkpoint"
                      data-active={detecting[camera.cam_id] ? 'true' : 'false'}
                    >
                      {detecting[camera.cam_id] ? 'Detection ON' : 'Detection OFF'}
                    </button>
                    <span className="dept-badge">{camera.department?.dep_name || 'General'}</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <h3>No checkpoints configured</h3>
              <p>Go to Checkpoints to add a fixed camera, IP stream, or mobile operator link.</p>
            </div>
          )}
        </div>
      )}

      {fullscreenCamera && (
        <div className="fullscreen-overlay">
          <div className="fullscreen-controls">
            <button className="close-fs-btn" onClick={() => setFullscreenCamera(null)}>
              &times;
            </button>
          </div>
          <img
            src={streamSrc(fullscreenCamera)}
            className="fullscreen-video"
            alt="Fullscreen Feed"
            onError={(e) => {
              e.target.onerror = null;
              alert('Stream connection lost');
              setFullscreenCamera(null);
            }}
          />
          <div className="fullscreen-caption">
            <h2>{fullscreenCamera.camera_name}</h2>
            <p>{fullscreenCamera.cam_id}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveStreamPage;
