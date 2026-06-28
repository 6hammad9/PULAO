import express from 'express';
import CameraInfo from '../models/CameraInfo.js';
import { VISION_PUBLIC_BASE_URL } from '../config/paths.js';

const router = express.Router();

const eventFilter = (req) => (req.query.event_id ? { event: req.query.event_id } : {});

const buildStreamUrl = (camera) => {
  const source = camera.stream_source || '';
  const port = camera.stream_port || 6033;

  if (/^(rtsp|http|https):\/\//i.test(source)) {
    return source;
  }

  switch (camera.stream_type) {
    case 'rtsp':
      return `rtsp://${source}`;
    case 'http':
    case 'mjpeg':
    case 'hls':
      return `http://${source}${port ? `:${port}` : ''}`;
    default:
      return `${VISION_PUBLIC_BASE_URL}/video_feed/${camera.cam_id}`;
  }
};

// GET total camera count
router.get('/count/total', async (req, res) => {
  try {
    const count = await CameraInfo.countDocuments(eventFilter(req));
    res.json({ count }); 
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET camera by cam_id (for streaming service)
router.get('/by-id/:cam_id', async (req, res) => {
  try {
    const camera = await CameraInfo.findOne({ cam_id: req.params.cam_id })
      .populate('department')
      .populate('department_area');

    if (!camera) {
      return res.status(404).json({ 
        message: 'Camera not found',
        details: `Camera ${req.params.cam_id} not registered`
      });
    }

    res.json({
      success: true,
      cam_id: camera.cam_id,
      camera_name: camera.camera_name,
      stream_source: camera.stream_source,
      stream_port: camera.stream_port || 6033,
      stream_type: camera.stream_type || 'local',
      stream_url: buildStreamUrl(camera),
      enabled: camera.enabled,
      connection_status: camera.connection_status,
      department: camera.department,
      department_area: camera.department_area
    });
  } catch (err) {
    res.status(500).json({ 
      message: 'Error fetching camera config',
      error: err.message 
    });
  }
});

// GET stream URL for a camera
router.get('/:id/stream-url', async (req, res) => {
  try {
    const camera = await CameraInfo.findById(req.params.id)
      .select('cam_id stream_source stream_port stream_type');
      
    if (!camera) {
      return res.status(404).json({ message: 'Camera not found' });
    }

    res.json({
      stream_url: buildStreamUrl(camera),
      config: {
        cam_id: camera.cam_id,
        stream_type: camera.stream_type,
        stream_source: camera.stream_source,
        stream_port: camera.stream_port
      }
    });
  } catch (err) {
    res.status(500).json({ 
      message: 'Error generating stream URL',
      error: err.message 
    });
  }
});

// GET all cameras
router.get('/', async (req, res) => {
  try {
    const cameras = await CameraInfo.find(eventFilter(req))
      .populate('department')
      .populate('department_area');
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ 
      message: 'Failed to fetch cameras',
      error: err.message 
    });
  }
});

// GET single camera
router.get('/:id', async (req, res) => {
  try {
    const camera = await CameraInfo.findById(req.params.id)
      .populate('department')
      .populate('department_area');
    if (!camera) {
      return res.status(404).json({ message: 'Camera not found' });
    }
    res.json(camera);
  } catch (err) {
    res.status(500).json({ 
      message: 'Failed to fetch camera',
      error: err.message 
    });
  }
});

// PATCH camera health/status from the vision service
router.patch('/:id/status', async (req, res) => {
  try {
    const { connection_status, last_error } = req.body;

    const updateData = {
      connection_status: connection_status || 'unknown',
      last_seen_at: new Date(),
      last_error: last_error || ''
    };

    const updatedCamera = await CameraInfo.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedCamera) {
      return res.status(404).json({ message: 'Camera not found' });
    }

    res.json(updatedCamera);
  } catch (err) {
    res.status(400).json({
      message: 'Error updating camera status',
      error: err.message
    });
  }
});

// POST new camera
router.post('/', async (req, res) => {
  try {
    const { 
      cam_id, 
      channel, 
      camera_name, 
      color, 
      department, 
      department_area,
      stream_source,
      stream_port,
      stream_type,
      stream_username,
      stream_password,
      enabled,
      event_id
    } = req.body;

    // Validate required fields
    if (!cam_id || !channel || !camera_name || !stream_source) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['cam_id', 'channel', 'camera_name', 'stream_source']
      });
    }

    const cameraData = {
      cam_id,
      channel,
      camera_name,
      color: color || '#ffffff',
      department: department || null,
      department_area: department_area || null,
      stream_source,
      stream_port: stream_port || 6033,
      stream_type: stream_type || 'local',
      stream_username: stream_username || '',
      stream_password: stream_password || '',
      enabled: enabled !== undefined ? enabled : true,
      event: event_id || null
    };

    const camera = new CameraInfo(cameraData);
    const newCamera = await camera.save();
    
    res.status(201).json(newCamera);
  } catch (err) {
    res.status(400).json({ 
      message: 'Error creating camera',
      error: err.message 
    });
  }
});

// PUT update camera
router.put('/:id', async (req, res) => {
  try {
    const { 
      department, 
      department_area,
      stream_source,
      stream_port,
      stream_type,
      stream_username,
      stream_password,
      enabled,
      ...otherData 
    } = req.body;

    // Validate required fields if they're being updated
    if (stream_source === '') {
      return res.status(400).json({ 
        message: 'stream_source cannot be empty'
      });
    }

    const updateData = {
      ...otherData,
      department: department || null,
      department_area: department_area || null,
      stream_source: stream_source !== undefined ? stream_source : undefined,
      stream_port: stream_port !== undefined ? stream_port : undefined,
      stream_type: stream_type !== undefined ? stream_type : undefined,
      stream_username: stream_username !== undefined ? stream_username : undefined,
      stream_password: stream_password !== undefined ? stream_password : undefined,
      enabled: enabled !== undefined ? enabled : undefined
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const updatedCamera = await CameraInfo.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedCamera) {
      return res.status(404).json({ message: 'Camera not found' });
    }
    
    res.json(updatedCamera);
  } catch (err) {
    res.status(400).json({ 
      message: 'Error updating camera',
      error: err.message 
    });
  }
});

// DELETE camera
router.delete('/:id', async (req, res) => {
  try {
    const deletedCamera = await CameraInfo.findByIdAndDelete(req.params.id);
    if (!deletedCamera) {
      return res.status(404).json({ message: 'Camera not found' });
    }
    res.json({ 
      message: 'Camera deleted successfully',
      deletedCamera 
    });
  } catch (err) {
    res.status(500).json({ 
      message: 'Error deleting camera',
      error: err.message 
    });
  }
});

export default router;
