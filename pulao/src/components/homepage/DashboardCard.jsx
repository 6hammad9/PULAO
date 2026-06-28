// src/components/DashboardCard.jsx
import React from 'react';

const DashboardCard = ({ title, count, onClick, color }) => {
  return (
    <button 
      className="dashboard-card" 
      onClick={onClick} 
      style={{ backgroundColor: color }}
      type="button"
    >
      <h3>{title}</h3>
      <div className="card-count">
        <span>{count}</span>
      </div>
    </button>
  );
};

export default DashboardCard;