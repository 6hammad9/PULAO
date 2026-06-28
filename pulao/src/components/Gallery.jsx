// src/components/Gallery.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import '../styles/Gallery.css';
import { apiPath } from '../config/api';

const Gallery = () => {
  const { eventId } = useParams();
  const [allImages, setAllImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // UI State
  const [activeTab, setActiveTab] = useState('All');
  const [selectedImage, setSelectedImage] = useState(null); // For Lightbox

  // Categories for the filter tabs
  const categories = ['All', 'Registered', 'Whitelisted', 'NotWhitelisted', 'Unclear'];

  const getTime = (value) => {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };

  useEffect(() => {
    fetchAllImages();
  }, [eventId]);

  const fetchAllImages = async () => {
    setLoading(true);
    setError('');

    try {
      const [regRes, detRes] = await Promise.all([
        axios.get(apiPath('/register-person'), { params: { event_id: eventId } }),
        axios.get(apiPath('/api/gallery-images'), { params: { event_id: eventId } })
      ]);

      // Process Registered Images
      const registered = regRes.data
        .filter(p => p.image)
        .map(p => ({
          id: `reg-${p._id || Math.random()}`,
          category: 'Registered',
          url: apiPath(`/uploads/${p.image}`),
          name: p.name || 'Unknown Person',
          date: p.createdAt || p.datetime
        }));

      // Process Detected Images (Whitelisted/Not/Unclear)
      const detected = detRes.data.map((img, idx) => ({
        id: `det-${img._id || idx}`,
        category: img.category, // API should return 'Whitelisted', 'NotWhitelisted', or 'Unclear'
        url: apiPath(img.url),
        name: img.person && img.person !== "Unknown" ? img.person : (img.filename || `Detection ${idx + 1}`),
        camera: img.camera || "",
        department: img.department || "",
        section: img.section || "",
        findings: img.findings || img.status || "",
        date: img.createdAt || img.datetime
      }));

      setAllImages(
        [...registered, ...detected].sort((a, b) => getTime(b.date) - getTime(a.date))
      );

    } catch (err) {
      console.error('Gallery load error:', err);
      setError('Failed to load gallery images. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  // Filter Logic
  const filteredImages = activeTab === 'All' 
    ? allImages 
    : allImages.filter(img => img.category === activeTab);

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <h1>Image Gallery</h1>
      </div>

      {/* Filter Tabs */}
      <div className="gallery-tabs">
        {categories.map(cat => (
          <button 
            key={cat} 
            className={`tab-btn ${activeTab === cat ? 'active' : ''}`}
            onClick={() => setActiveTab(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Loading State */}
      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p style={{marginTop: '1rem'}}>Loading images...</p>
        </div>
      ) : (
        <div className="gallery-grid">
          {filteredImages.length > 0 ? (
            filteredImages.map((img) => (
              <div 
                className="gallery-card" 
                key={img.id}
                onClick={() => setSelectedImage(img)}
              >
                <div className="image-wrapper">
                  <img 
                    src={img.url} 
                    alt={img.name} 
                    onError={(e) => {
                      e.target.onerror = null; 
                      e.target.src = 'https://via.placeholder.com/300?text=Image+Error';
                    }}
                  />
                  {activeTab === 'All' && (
                    <span className="category-badge" style={{
                      backgroundColor: 
                        img.category === 'NotWhitelisted' ? '#ef4444' : 
                        img.category === 'Whitelisted' ? '#10b981' : 
                        img.category === 'Unclear' ? '#f59e0b' : '#4f46e5'
                    }}>
                      {img.category}
                    </span>
                  )}
                </div>
                <div className="card-details">
                  <p className="card-name" title={img.name}>{img.name}</p>
                  {img.camera && (
                    <p className="card-meta" title={`Camera ${img.camera}`}>
                      📷 Cam {img.camera}
                      {img.department ? ` · ${img.department}` : ''}
                      {img.section ? ` / ${img.section}` : ''}
                    </p>
                  )}
                  {img.date && (
                    <p className="card-meta">🕒 {new Date(img.date).toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <h3>No images found</h3>
              <p>There are no images in the "{activeTab}" category yet.</p>
            </div>
          )}
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedImage && (
        <div className="lightbox-overlay" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setSelectedImage(null)}>&times;</button>
            <img src={selectedImage.url} alt={selectedImage.name} />
            <div className="lightbox-caption">
              <h3>{selectedImage.name}</h3>
              <span style={{opacity: 0.8}}>
                {selectedImage.category}
                {selectedImage.camera ? ` · Cam ${selectedImage.camera}` : ''}
                {selectedImage.department ? ` · ${selectedImage.department}` : ''}
                {selectedImage.section ? ` / ${selectedImage.section}` : ''}
                {selectedImage.date ? ` · ${new Date(selectedImage.date).toLocaleString()}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gallery;
