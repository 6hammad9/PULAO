// src/App.jsx
import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import axios from "axios";
import "./styles/App.css";
import { apiPath, visionPath } from "./config/api";

// Components
import HomePage from "./components/HomePage";
import Gallery from "./components/Gallery";
import CameraInfo from "./components/CameraInfo";
import NotWhitelisted from "./components/NotWhitelisted";
import LiveStreamPage from "./components/LiveStreamPage";
import RegisterPerson from "./components/RegisterPerson";
import AlertsPage from "./components/AlertsPage";
import AlertsNavLink from "./components/AlertsNavLink";
import EventsPage from "./components/EventsPage";
import Login from "./components/Login";

function App() {
  const location = useLocation();
  const [activeEvent, setActiveEvent] = useState(null);
  const eventId = location.pathname.match(/^\/events\/([^/]+)/)?.[1] || "";
  const isAuthPage = location.pathname === "/" || location.pathname === "/login" || location.pathname === "/register";
  const scoped = (path) => eventId ? `/events/${eventId}${path}` : "/events";

  useEffect(() => {
    let alive = true;
    if (!eventId) {
      setActiveEvent(null);
      axios.post(visionPath("/context"), { event_id: "" }, { timeout: 3000 }).catch(() => {});
      return;
    }

    axios.post(visionPath("/context"), { event_id: eventId }, { timeout: 5000 }).catch(() => {});

    axios
      .get(apiPath(`/api/events/${eventId}`))
      .then(({ data }) => {
        if (alive) setActiveEvent(data);
      })
      .catch(() => {
        if (alive) setActiveEvent(null);
      });

    return () => {
      alive = false;
    };
  }, [eventId]);

  const navItems = [
    { to: scoped("/dashboard"), label: "Command Center", code: "CC" },
    { to: scoped("/live"), label: "Live Operations", code: "LO" },
    { to: scoped("/gallery"), label: "Gallery", code: "GL" },
    { to: scoped("/people"), label: "People", code: "PE" },
    { to: scoped("/checkpoints"), label: "Checkpoints", code: "CP" },
    { to: scoped("/review"), label: "Access Review", code: "AR" },
    { to: scoped("/timeline"), label: "Timeline", code: "TL" },
  ];

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="brand-block">
          <img className="brand-mark" src="/files/pulao-icon-black.svg" alt="" aria-hidden="true" />
          <div>
            <img className="logo-wordmark" src="/files/pulao-wordmark-black.svg" alt="PULAO" />
            <div className="brand-subtitle">Access operations platform</div>
          </div>
        </div>

        {eventId ? (
          <div className="event-context">
            <span>Current event</span>
            <strong>{activeEvent?.name || "Loading event..."}</strong>
            <small>{activeEvent?.venue || activeEvent?.status || "Workspace"}</small>
          </div>
        ) : (
          <div className="event-context empty">
            <span>No event selected</span>
            <strong>Select an event</strong>
            <small>Open an event to unlock dashboard, people, cameras, and alerts.</small>
          </div>
        )}

        <div className="nav-links">
          <NavLink to="/events" end className={({ isActive }) => isActive && !eventId ? "nav-item active" : "nav-item"}>
            <span className="nav-icon">EV</span>
            <span>{eventId ? "Back to Events" : "Events"}</span>
          </NavLink>

          {eventId ? (
            <>
              {navItems.slice(0, 5).map(({ to, label, code }) => (
                <NavLink key={to} to={to} className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
                  <span className="nav-icon">{code}</span>
                  <span>{label}</span>
                </NavLink>
              ))}

              <AlertsNavLink eventId={eventId} />

              {navItems.slice(5).map(({ to, label, code }) => (
                <NavLink key={to} to={to} className={({ isActive }) => isActive ? "nav-item active" : "nav-item"}>
                  <span className="nav-icon">{code}</span>
                  <span>{label}</span>
                </NavLink>
              ))}
            </>
          ) : (
            <div className="nav-locked-note">
              Workspace pages appear here after you open an event.
            </div>
          )}
        </div>

        <div className="sidebar-status">
          <span className="status-dot"></span>
          <span>Local console</span>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<Navigate to="dashboard" replace />} />
          <Route path="/events/:eventId/dashboard" element={<HomePage />} />
          <Route path="/events/:eventId/people" element={<RegisterPerson />} />
          <Route path="/events/:eventId/gallery" element={<Gallery />} />
          <Route path="/events/:eventId/review" element={<NotWhitelisted />} />
          <Route path="/events/:eventId/alerts" element={<AlertsPage />} />
          <Route path="/events/:eventId/checkpoints" element={<CameraInfo />} />
          <Route path="/events/:eventId/timeline" element={<div style={{padding: '2rem'}}><h2>Timeline</h2><p>Cross-camera journey tracking will live here.</p></div>} />
          <Route path="/events/:eventId/live" element={<LiveStreamPage />} />

          <Route path="/dashboard" element={<Navigate to="/events" />} />
          <Route path="/Registerperson" element={<Navigate to="/events" />} />
          <Route path="/Gallery" element={<Navigate to="/events" />} />
          <Route path="/NotWhitelisted" element={<Navigate to="/events" />} />
          <Route path="/alerts" element={<Navigate to="/events" />} />
          <Route path="/CameraInfo" element={<Navigate to="/events" />} />
          <Route path="/multistream" element={<Navigate to="/events" />} />
          <Route path="/LiveStreamPage" element={<Navigate to="/events" />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
