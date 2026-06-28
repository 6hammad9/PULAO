// src/components/AlertsNavLink.jsx
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import axios from "axios";
import { apiPath } from "../config/api";

const AlertsNavLink = ({ eventId }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const { data } = await axios.get(apiPath("/api/alerts/count"), {
          params: eventId ? { event_id: eventId } : {},
        });
        if (active) setCount(data.count || 0);
      } catch {
        /* backend down: leave count as-is */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [eventId]);

  return (
    <NavLink
      to={eventId ? `/events/${eventId}/alerts` : "/events"}
      className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
    >
      <span className="nav-icon">AL</span>
      <span>Alerts</span>
      {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
    </NavLink>
  );
};

export default AlertsNavLink;
