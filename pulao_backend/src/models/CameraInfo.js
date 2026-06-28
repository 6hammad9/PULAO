// models/CameraInfo.js
import mongoose from 'mongoose';

const cameraSchema = new mongoose.Schema({
  cam_id: { type: String, required: true },
  channel: { type: Number, required: true },
  camera_name: { type: String, required: true },
  color: { type: String, default: '#ffffff' },
  read_status: { type: Number, default: 0 },
  stream_source: { type: String, required: true }, // e.g. "0" for webcam, "rtsp://..."
  stream_type: {
    type: String,
    enum: ['local', 'rtsp', 'http', 'mjpeg', 'hls', 'mobile'],
    default: 'local'
  },
  stream_port: { type: Number, default: 6033 },
  stream_username: { type: String, default: '' },
  stream_password: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  connection_status: {
    type: String,
    enum: ['unknown', 'online', 'offline', 'error'],
    default: 'unknown'
  },
  last_seen_at: { type: Date, default: null },
  last_error: { type: String, default: '' },
  department: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    validate: {
      validator: (v) => v === null || mongoose.Types.ObjectId.isValid(v),
      message: props => `${props.value} is not a valid department ID!`
    }
  },
  department_area: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DepartmentArea',
    default: null,
    validate: {
      validator: (v) => v === null || mongoose.Types.ObjectId.isValid(v),
      message: props => `${props.value} is not a valid area ID!`
    }
    
  }
  ,
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null }
  
}, { timestamps: true });

cameraSchema.index({ event: 1, cam_id: 1 }, { unique: true, sparse: true });

const CameraInfo = mongoose.model('CameraInfo', cameraSchema);
export default CameraInfo;
