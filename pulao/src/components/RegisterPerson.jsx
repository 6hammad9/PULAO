// src/components/RegisterPerson.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import "../styles/RegisterPerson.css";
import { apiPath } from "../config/api";

// Helper to construct image URL
const getImageUrl = (filename) => {
  if (!filename) return "https://via.placeholder.com/400x300?text=No+Image";
  return apiPath(`/whitelisted/${filename}`);
};

const RegisterPerson = () => {
  const { eventId } = useParams();
  // --- Data State ---
  const [registeredPersons, setRegisteredPersons] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // --- UI State ---
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);

  // --- Form State ---
  const [name, setName] = useState("");
  const [status, setStatus] = useState("whitelisted"); // Default
  const [personType, setPersonType] = useState("employee");
  const [selectedCameras, setSelectedCameras] = useState([]); // array of camera _ids
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  // --- Initial Fetch ---
  useEffect(() => {
    fetchInitialData();
  }, [eventId]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [personsRes, camerasRes] = await Promise.all([
        axios.get(apiPath("/register-person"), { params: { event_id: eventId } }),
        axios.get(apiPath("/api/cameras"), { params: { event_id: eventId } })
      ]);
      setRegisteredPersons(personsRes.data);
      setCameras(camerasRes.data);
    } catch (err) {
      console.error(err);
      setError("Failed to load data. Please check connection.");
    } finally {
      setLoading(false);
    }
  };

  // --- Form Handlers ---
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      // Create a local preview URL
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
    }
  };

  const toggleCamera = (id) => {
    setSelectedCameras((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  // Resolve a person's allowed cameras to an array of _id strings, falling back
  // to the legacy single cam_id for un-migrated records.
  const getAllowedCameraIds = (person) => {
    if (person.allowed_cameras?.length) {
      return person.allowed_cameras.map((c) => String(c?._id || c));
    }
    if (person.cam_id) return [String(person.cam_id?._id || person.cam_id)];
    return [];
  };

  const openAddModal = () => {
    setIsEditing(false);
    setCurrentId(null);
    setName("");
    setStatus("whitelisted");
    setPersonType("employee");
    setSelectedCameras([]);
    setImage(null);
    setImagePreview(null);
    setShowModal(true);
  };

  const openEditModal = (person) => {
    setIsEditing(true);
    setCurrentId(person._id);
    setName(person.name);
    setStatus(person.status);
    setPersonType(person.person_type || "employee");
    setSelectedCameras(getAllowedCameraIds(person)); // pre-check existing cameras

    setImage(null); // Reset new image
    setImagePreview(getImageUrl(person.image)); // Show existing image as preview
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (selectedCameras.length === 0) {
      alert("Select at least one allowed checkpoint.");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("status", status);
      formData.append("person_type", personType);
      // Multi-camera: send each allowed camera plus a legacy cam_id (the first).
      selectedCameras.forEach((id) => formData.append("allowed_cameras", id));
      formData.append("cam_id", selectedCameras[0]);
      formData.append("event_id", eventId);
      if (image) {
        formData.append("image", image);
      }

      if (isEditing) {
        await axios.put(apiPath(`/register-person/${currentId}`), formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await axios.post(apiPath("/register-person"), formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      setShowModal(false);
      await fetchInitialData(); // Refresh list
    } catch (err) {
      console.error(err);
      alert("Failed to save person. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this person? This cannot be undone.")) {
      try {
        await axios.delete(apiPath(`/register-person/${id}`));
        // Optimistic update for speed
        setRegisteredPersons(prev => prev.filter(p => p._id !== id));
      } catch (err) {
        alert("Failed to delete.");
      }
    }
  };

  return (
    <div className="register-page">
      {/* Header */}
      <div className="page-header">
        <h1>Person Management</h1>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Register Person
        </button>
      </div>

      {/* Error Message */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Loading State */}
      {loading && !registeredPersons.length ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : (
        /* Content Grid */
        <div className="person-grid">
          {registeredPersons.length > 0 ? (
            registeredPersons.map((person) => (
              <div key={person._id} className="person-card">
                {/* Image Section */}
                <img 
                  src={getImageUrl(person.image)} 
                  alt={person.name} 
                  className="card-img-top"
                  onError={(e) => { e.target.src = "https://via.placeholder.com/400x300?text=Error"; }}
                />
                
                {/* Details Section */}
                <div className="card-body">
                  <div className="person-heading-row">
                    <h3>{person.name}</h3>
                    <span
                      className="status-badge"
                      style={{
                        background: person.person_type === 'banned' ? '#dc2626'
                          : person.person_type === 'vip' ? '#9333ea' : '#16a34a',
                        color: '#fff',
                        textTransform: 'capitalize',
                      }}
                    >
                      {person.person_type === 'banned' ? 'Banned' : (person.person_type || 'employee')}
                    </span>
                  </div>
                  
                  <div className="info-row">
                    <span>Checkpoints:</span>
                    <strong>
                      {person.allowed_cameras?.length
                        ? person.allowed_cameras
                            .map((c) => c?.camera_name || c?.cam_id)
                            .filter(Boolean)
                            .join(", ")
                        : person.cam_id?.camera_name || "N/A"}
                    </strong>
                  </div>

                  <div className="card-actions">
                    <button className="btn btn-outline-primary btn-full" onClick={() => openEditModal(person)}>
                      Edit
                    </button>
                    <button className="btn btn-outline-danger btn-full" onClick={() => handleDelete(person._id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
             <div className="empty-state">
                <h3>No registered persons found.</h3>
                <p>Click "Register Person" to add someone to the database.</p>
             </div>
          )}
        </div>
      )}

      {/* --- Add/Edit Modal --- */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{isEditing ? "Edit Person" : "Register New Person"}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                
                {/* Custom Image Upload */}
                <div className="form-group">
                  <label>Photo</label>
                  <div className="image-upload-area" onClick={() => document.getElementById('fileInput').click()}>
                    <input 
                      id="fileInput" 
                      type="file" 
                      accept="image/*" 
                      onChange={handleImageChange}
                    />
                    {imagePreview ? (
                      <div>
                         <img src={imagePreview} alt="Preview" className="image-preview" />
                         <button 
                           type="button" 
                           className="remove-image-btn"
                           onClick={(e) => {
                             e.stopPropagation();
                             setImage(null);
                             setImagePreview(null);
                           }}
                         >
                           Remove / Change
                         </button>
                      </div>
                    ) : (
                      <div className="upload-placeholder">
                        <span className="upload-icon">PHOTO</span>
                        <span>Click to upload photo</span>
                        <small>Supports JPG, PNG</small>
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>Full Name</label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                    required 
                    placeholder="e.g. John Doe"
                  />
                </div>

                <div className="form-group">
                  <label>Allowed Checkpoints</label>
                  {cameras.length === 0 ? (
                    <p className="checklist-empty">No cameras in this event yet. Add a checkpoint first.</p>
                  ) : (
                    <div className="camera-checklist">
                      {cameras.map((cam) => (
                        <label key={cam._id} className="camera-check-item">
                          <input
                            type="checkbox"
                            checked={selectedCameras.includes(cam._id)}
                            onChange={() => toggleCamera(cam._id)}
                          />
                          <span>{cam.camera_name} <small>({cam.cam_id})</small></span>
                        </label>
                      ))}
                    </div>
                  )}
                  <small className="checklist-hint">
                    {selectedCameras.length} checkpoint{selectedCameras.length === 1 ? "" : "s"} selected
                  </small>
                </div>
                
                <div className="form-group">
                  <label>Person Type</label>
                  <select
                    value={personType}
                    onChange={(e) => setPersonType(e.target.value)}
                  >
                    <option value="employee">Employee</option>
                    <option value="visitor">Visitor</option>
                    <option value="contractor">Contractor</option>
                    <option value="vip">VIP</option>
                    <option value="banned">Banned (Watchlist)</option>
                  </select>
                  {personType === "banned" && (
                    <small style={{ color: "#dc2626", display: "block", marginTop: "4px" }}>
                      A critical alert fires whenever this person is detected on any camera.
                    </small>
                  )}
                </div>

                {/* Hidden status field since logic seemed to default to whitelisted */}
                <input type="hidden" value={status} />

              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Saving..." : isEditing ? "Update Person" : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegisterPerson;
