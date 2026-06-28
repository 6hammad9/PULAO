// src/components/AlertsPage.jsx
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import "../styles/AlertsPage.css";
import { apiPath } from "../config/api";

const API = apiPath("/api/alerts");

const SEVERITY = {
  critical: { bg: "#fee2e2", border: "#dc2626", label: "CRITICAL", dot: "#dc2626" },
  warning: { bg: "#fef3c7", border: "#d97706", label: "WARNING", dot: "#d97706" },
  info: { bg: "#e0f2fe", border: "#0284c7", label: "INFO", dot: "#0284c7" },
};

const TABS = ["new", "acknowledged", "resolved", "all"];

const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleString();
};

const AlertsPage = () => {
  const { eventId } = useParams();
  const [alerts, setAlerts] = useState([]);
  const [tab, setTab] = useState("new");
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const params = { ...(tab === "all" ? {} : { status: tab }), event_id: eventId };
      const { data } = await axios.get(API, { params });
      setAlerts(data);
    } catch (err) {
      console.error("Failed to load alerts:", err);
    } finally {
      setLoading(false);
    }
  }, [tab, eventId]);

  useEffect(() => {
    setLoading(true);
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const acknowledge = async (id) => {
    await axios.patch(`${API}/${id}/acknowledge`);
    fetchAlerts();
  };

  const resolve = async (id) => {
    await axios.patch(`${API}/${id}/resolve`);
    fetchAlerts();
  };

  const acknowledgeAll = async () => {
    await axios.post(`${API}/acknowledge-all`, null, { params: { event_id: eventId } });
    fetchAlerts();
  };

  return (
    <div className="alerts-page">
      <header className="alerts-header">
        <div>
          <p className="overline">Incident queue</p>
          <h1>Alerts</h1>
          <p>Track watchlist matches and access exceptions as they move from new to acknowledged to resolved.</p>
        </div>
        <button onClick={acknowledgeAll} className="btn btn-primary">
          Acknowledge all
        </button>
      </header>

      <div className="alerts-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`alerts-tab ${tab === t ? "active" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-kicker">Clear</div>
          <h3>No {tab === "all" ? "" : tab} alerts</h3>
        </div>
      ) : (
        <div className="alerts-list">
          {alerts.map((a) => {
            const sev = SEVERITY[a.severity] || SEVERITY.info;
            return (
              <div
                key={a._id}
                className={`alert-row ${a.status === "new" ? "new" : ""}`}
                style={{ "--severity": sev.border, "--severity-bg": sev.bg }}
              >
                <span className="severity-badge" style={{ background: sev.dot }}>
                  {sev.label}
                </span>

                <div className="alert-copy">
                  <div className="alert-title">{a.title}</div>
                  <div className="alert-meta">
                    {a.camera_name || `Cam ${a.cam}`}
                    {a.confidence ? ` - ${(a.confidence * 100).toFixed(0)}% match` : ""}
                    {" - "}{timeAgo(a.createdAt)}
                    {a.status !== "new" && ` - ${a.status}`}
                  </div>
                </div>

                {a.status === "new" && (
                  <button onClick={() => acknowledge(a._id)} className="btn btn-secondary">Acknowledge</button>
                )}
                {a.status !== "resolved" && (
                  <button onClick={() => resolve(a._id)} className="btn btn-primary">Resolve</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AlertsPage;
