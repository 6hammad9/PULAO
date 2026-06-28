// src/components/CameraManagement.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import '../styles/CameraManagement.css';
import { apiPath, MOBILE_HOST, VISION_HTTPS_PORT } from '../config/api';

const MobileCheckpointAccess = ({ url, onCopy }) => {
  const [qrSrc, setQrSrc] = useState('');

  useEffect(() => {
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 5,
      color: {
        dark: '#111111',
        light: '#ffffff'
      }
    })
      .then(setQrSrc)
      .catch(() => setQrSrc(''));
  }, [url]);

  return (
    <div className="mobile-checkpoint-access">
      <div className="mobile-checkpoint-copy">
        <span>Phone checkpoint link</span>
        <strong>{url.replace(/^https?:\/\//, '')}</strong>
        <button className="btn btn-outline-primary" type="button" onClick={onCopy}>
          Copy Link
        </button>
      </div>
      {qrSrc && <img src={qrSrc} alt={`QR code for ${url}`} />}
    </div>
  );
};

const CameraManagement = () => {
  const { eventId } = useParams();
  
  // --- State Management ---
  const [cameras, setCameras] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [departmentAreas, setDepartmentAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modals
  const [showModal, setShowModal] = useState(false);
  const [modalTitle, setModalTitle] = useState('Create Checkpoint');
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showAreaModal, setShowAreaModal] = useState(false);

  // Forms
  const [currentCamera, setCurrentCamera] = useState(null);
  const [formData, setFormData] = useState({
    cam_id: '',
    channel: '',
    camera_name: '',
    color: '#6366f1', // Default indigo
    department: '',
    department_area: '',
    stream_source: '0',
    stream_port: 6033,
    stream_type: 'local',
    stream_username: '',
    stream_password: '',
    enabled: true
  });
  const [newDepartment, setNewDepartment] = useState('');
  const [newArea, setNewArea] = useState({ name: '', department: '' });

  // --- Initial Load ---
  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [camerasRes, deptsRes, areasRes] = await Promise.all([
        axios.get(apiPath('/api/cameras'), { params: { event_id: eventId } }),
        axios.get(apiPath('/api/departments'), { params: { event_id: eventId } }),
        axios.get(apiPath('/api/departments/areas'), { params: { event_id: eventId } })
      ]);
      setCameras(camerasRes.data);
      setDepartments(deptsRes.data);
      setDepartmentAreas(areasRes.data);
    } catch (err) {
      console.error(err);
      setError('Could not connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  // --- Handlers ---
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const makeMobileToken = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const getMobileCaptureUrl = (cam) => {
    const currentHost = window.location.hostname || 'localhost';
    const host = ['localhost', '127.0.0.1', '::1'].includes(currentHost) ? MOBILE_HOST : currentHost;
    const port = VISION_HTTPS_PORT;
    return `https://${host}:${port}/mobile_camera/${encodeURIComponent(cam.cam_id)}?token=${encodeURIComponent(cam.stream_source || '')}&event_id=${encodeURIComponent(eventId)}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const payload = {
        ...formData,
        event_id: eventId,
        department: formData.department || null,
        department_area: formData.department_area || null
      };
      if (payload.stream_type === 'mobile' && !payload.stream_source) {
        payload.stream_source = makeMobileToken();
      }
      if (currentCamera && !payload.stream_password) {
        delete payload.stream_password;
      }

      if (currentCamera) {
        await axios.put(apiPath(`/api/cameras/${currentCamera._id}`), payload);
      } else {
        await axios.post(apiPath('/api/cameras'), payload);
      }
      
      setShowModal(false);
      await fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDepartment = async (e) => {
    e.preventDefault();
    try {
      await axios.post(apiPath('/api/departments'), { dep_name: newDepartment, event_id: eventId });
      setNewDepartment('');
      setShowDeptModal(false);
      await fetchData();
    } catch (err) {
      alert('Failed to add department');
    }
  };

  const handleAddArea = async (e) => {
    e.preventDefault();
    try {
      await axios.post(apiPath('/api/departments/areas'), { ...newArea, event_id: eventId });
      setNewArea({ name: '', department: '' });
      setShowAreaModal(false);
      await fetchData();
    } catch (err) {
      alert('Failed to add area');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this camera permanently?')) {
      try {
        await axios.delete(apiPath(`/api/cameras/${id}`));
        fetchData();
      } catch (err) {
        alert('Failed to delete');
      }
    }
  };

  const openAddModal = () => {
    setCurrentCamera(null);
    setModalTitle('Create Checkpoint');
    setFormData({
      cam_id: '', channel: '', camera_name: '', color: '#6366f1',
      department: '', department_area: '', stream_source: '', stream_port: 6033,
      stream_type: 'local', stream_username: '', stream_password: '', enabled: true
    });
    setShowModal(true);
  };

  const openEditModal = (cam) => {
    setCurrentCamera(cam);
    setModalTitle('Edit Checkpoint');
    setFormData({
      cam_id: cam.cam_id,
      channel: cam.channel,
      camera_name: cam.camera_name,
      color: cam.color || '#6366f1',
      department: cam.department?._id || '',
      department_area: cam.department_area?._id || '',
      stream_source: cam.stream_source || '',
      stream_port: cam.stream_port || 6033,
      stream_type: cam.stream_type || 'local',
      stream_username: cam.stream_username || '',
      stream_password: '',
      enabled: cam.enabled !== false
    });
    setShowModal(true);
  };

  const filteredAreas = formData.department 
    ? departmentAreas.filter(area => area.department && area.department._id === formData.department)
    : [];

  // --- Render ---
  return (
    <div className="camera-management">
      {/* Header */}
      <div className="header">
        <h1>
          Checkpoints
        </h1>
        <div className="header-buttons">
          <button className="btn btn-secondary" onClick={() => setShowDeptModal(true)}>+ Department</button>
          <button className="btn btn-secondary" onClick={() => setShowAreaModal(true)}>+ Area</button>
          <button className="btn btn-primary" onClick={openAddModal}>Create Checkpoint</button>
        </div>
      </div>
      <p className="section-lede">
        Configure fixed cameras, public streams, and consent-based mobile operator links.
      </p>

      {/* Error Message */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Grid Content */}
      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : (
        <div className="camera-grid">
          {cameras.length > 0 ? (
            cameras.map(cam => (
              <div key={cam._id} className="camera-card">
                {/* Colored Top Border based on camera color */}
                <div style={{ height: '6px', background: cam.color || '#ddd' }} />
                
                <div className="card-body">
                  <div className="card-header-row">
                    <h3 className="card-title">{cam.camera_name}</h3>
                    <span className="status-badge">{cam.connection_status || cam.stream_type}</span>
                  </div>
                  
                  <div className="card-info">
                    <p><strong>ID:</strong> {cam.cam_id}</p>
                    <p><strong>Channel:</strong> {cam.channel}</p>
                    <p><strong>Source:</strong> <span title={cam.stream_type === 'mobile' ? 'Consent token protected' : cam.stream_source} style={{maxWidth:'150px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{cam.stream_type === 'mobile' ? 'Consent link' : cam.stream_source}</span></p>
                    <p><strong>Type:</strong> {cam.stream_type || 'local'}</p>
                    <p><strong>Enabled:</strong> {cam.enabled === false ? 'No' : 'Yes'}</p>
                    <p><strong>Dept:</strong> {cam.department?.dep_name || '—'}</p>
                    <p><strong>Area:</strong> {cam.department_area?.area_name || '—'}</p>
                  </div>

                  <div className="card-actions">
                    <button className="btn btn-outline-primary" onClick={() => openEditModal(cam)}>Edit</button>
                    <button className="btn btn-outline-danger" onClick={() => handleDelete(cam._id)}>Delete</button>
                  </div>
                  {cam.stream_type === 'mobile' && (
                    <MobileCheckpointAccess
                      url={getMobileCaptureUrl(cam)}
                      onCopy={() => navigator.clipboard.writeText(getMobileCaptureUrl(cam))}
                    />
                  )}
                </div>
              </div>
            ))
          ) : (
            <div style={{gridColumn: '1/-1', textAlign: 'center', color: '#666', padding: '3rem'}}>
              <h3>No checkpoints found</h3>
              <p>Create a fixed, IP, or mobile checkpoint to begin monitoring.</p>
            </div>
          )}
        </div>
      )}

      {/* --- Main Camera Modal --- */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modalTitle}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label>Checkpoint ID</label>
                    <input type="text" name="cam_id" value={formData.cam_id} onChange={handleInputChange} required placeholder="e.g. CP-001" />
                  </div>
                  <div className="form-group">
                    <label>Checkpoint Name</label>
                    <input type="text" name="camera_name" value={formData.camera_name} onChange={handleInputChange} required placeholder="e.g. Lobby Gate" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Channel</label>
                    <input type="number" name="channel" value={formData.channel} onChange={handleInputChange} required />
                  </div>
                  <div className="form-group">
                    <label>Tag Color</label>
                    <div style={{display:'flex', gap:'10px'}}>
                      <input type="color" name="color" value={formData.color} onChange={handleInputChange} style={{width: '50px', padding: '2px', height:'42px'}} />
                      <span style={{lineHeight:'42px', color:'#666'}}>{formData.color}</span>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Department</label>
                    <div className="select-with-add">
                      <select name="department" value={formData.department} onChange={handleInputChange}>
                        <option value="">Select Dept</option>
                        {departments.map(d => <option key={d._id} value={d._id}>{d.dep_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Area</label>
                    <select name="department_area" value={formData.department_area} onChange={handleInputChange} disabled={!formData.department}>
                      <option value="">Select Area</option>
                      {filteredAreas.map(a => <option key={a._id} value={a._id}>{a.area_name}</option>)}
                    </select>
                  </div>
                </div>

                <hr style={{margin:'1rem 0', border:'0', borderTop:'1px solid #eee'}} />

                <div className="form-row">
                  <div className="form-group">
                    <label>Source / Consent Token</label>
                    <input
                      type="text"
                      name="stream_source"
                      value={formData.stream_source}
                      onChange={handleInputChange}
                      required={formData.stream_type !== 'mobile'}
                      placeholder={formData.stream_type === 'mobile' ? 'Consent token, auto-generated if blank' : 'RTSP URL or Device ID'}
                    />
                    {formData.stream_type === 'mobile' && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{marginTop: '0.5rem'}}
                        onClick={() => setFormData({...formData, stream_source: makeMobileToken()})}
                      >
                        Generate Consent Token
                      </button>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Port</label>
                    <input type="number" name="stream_port" value={formData.stream_port} onChange={handleInputChange} />
                  </div>
                </div>
                
                <div className="form-group">
                  <label>Checkpoint Source Type</label>
                  <select name="stream_type" value={formData.stream_type} onChange={handleInputChange}>
                    <option value="local">Local</option>
                    <option value="rtsp">RTSP</option>
                    <option value="http">HTTP</option>
                    <option value="mjpeg">MJPEG</option>
                    <option value="hls">HLS</option>
                    <option value="mobile">Mobile Browser</option>
                  </select>
                  {formData.stream_type === 'mobile' && (
                    <small style={{display: 'block', marginTop: '0.5rem', color: '#64748b'}}>
                      Mobile cameras only stream after the phone opens the consent link and grants camera permission.
                    </small>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Username</label>
                    <input type="text" name="stream_username" value={formData.stream_username} onChange={handleInputChange} placeholder="Optional" />
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <input type="password" name="stream_password" value={formData.stream_password} onChange={handleInputChange} placeholder={currentCamera ? "Leave blank to keep existing" : "Optional"} />
                  </div>
                </div>

                <div className="form-group">
                  <label style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
                    <input type="checkbox" name="enabled" checked={formData.enabled} onChange={handleInputChange} />
                    Enabled
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{loading ? 'Saving...' : 'Save Checkpoint'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Department Modal --- */}
      {showDeptModal && (
        <div className="modal-overlay" onClick={() => setShowDeptModal(false)}>
          <div className="modal" style={{maxWidth: '400px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Department</h2>
              <button className="close-btn" onClick={() => setShowDeptModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddDepartment}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Department Name</label>
                  <input type="text" value={newDepartment} onChange={e => setNewDepartment(e.target.value)} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary">Add Department</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Area Modal --- */}
      {showAreaModal && (
        <div className="modal-overlay" onClick={() => setShowAreaModal(false)}>
          <div className="modal" style={{maxWidth: '400px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Area</h2>
              <button className="close-btn" onClick={() => setShowAreaModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddArea}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Department</label>
                  <select value={newArea.department} onChange={e => setNewArea({...newArea, department: e.target.value})} required>
                    <option value="">Select Dept</option>
                    {departments.map(d => <option key={d._id} value={d._id}>{d.dep_name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Area Name</label>
                  <input type="text" value={newArea.name} onChange={e => setNewArea({...newArea, name: e.target.value})} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="submit" className="btn btn-primary">Add Area</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraManagement;
