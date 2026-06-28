// src/components/DetailsPopup.jsx
import React from 'react';

const DetailsPopup = ({ data, onClose, title }) => {
  const safeData = Array.isArray(data) ? data : [];

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-content" onClick={(e) => e.stopPropagation()}>
        
        {/* Sticky Header */}
        <div className="popup-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Scrollable List */}
        <div className="details-list">
          {safeData.length > 0 ? (
            safeData.map((item, index) => (
              <div key={index} className="detail-item">
                
                {/* --- Logic for Specific Data Types --- */}
                
                {title === 'Active Cameras' && (
                  <>
                    <p><strong>ID:</strong> {item.cam_id}</p>
                    <p><strong>Name:</strong> {item.camera_name}</p>
                    <p><strong>Department:</strong> {item.department?.name}</p>
                    <p><strong>Last Active:</strong> {new Date(item.datetime).toLocaleString()}</p>
                  </>
                )}

                {title === 'Whitelisted Personnel' && (
                  <>
                    <p><strong>Name:</strong> {item.name}</p>
                    <p><strong>Status:</strong> {item.status}</p>
                    <p><strong>Checkpoints:</strong> {item.cameras || `${item.cameraName} (${item.cameraId})`}</p>
                    <p><strong>Last Seen:</strong> {item.datetime
                      ? `${new Date(item.datetime).toLocaleString()}${item.lastSeenCamera ? ` @ Cam ${item.lastSeenCamera}` : ""}`
                      : "N/A"}</p>
                  </>
                )}

                {title === 'Non-Whitelisted' && (
                  <>
                    <p><strong>Name:</strong> {item.name}</p>
                    <p><strong>Findings:</strong> {item.findings}</p>
                    <p><strong>Camera:</strong> {item.cam}</p>
                    <p><strong>Area:</strong> {item.section} ({item.department})</p>
                    <p><strong>Detected:</strong> {item.datetime ? new Date(item.datetime).toLocaleString() : "Unknown"}</p>
                  </>
                )}

                {title === 'Unclear Pictures' && (
                  <>
                    <p><strong>Camera:</strong> {item.cam}</p>
                    <p><strong>Reason:</strong> {item.reason || 'Low quality image'}</p>
                    <p><strong>Time:</strong> {new Date(item.datetime).toLocaleString()}</p>
                  </>
                )}

              </div>
            ))
          ) : (
            <p style={{textAlign: 'center', color: '#666', padding: '2rem'}}>
              No records found for {title}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailsPopup;