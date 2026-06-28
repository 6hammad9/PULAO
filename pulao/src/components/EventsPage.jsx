import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/EventsPage.css";
import { apiPath, visionPath } from "../config/api";

const emptyForm = {
  name: "",
  venue: "",
  description: "",
  starts_at: "",
  status: "draft",
};

const EventsPage = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const clearVisionContext = async () => {
    try {
      await axios.post(visionPath("/context"), { event_id: "" }, { timeout: 3000 });
    } catch {
      // Vision service may be offline on the events screen.
    }
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(apiPath("/api/events"));
      setEvents(data);

      const summaryPairs = await Promise.all(
        data.slice(0, 12).map(async (event) => {
          try {
            const res = await axios.get(apiPath(`/api/events/${event._id}/summary`));
            return [event._id, res.data];
          } catch {
            return [event._id, null];
          }
        })
      );
      setSummaries(Object.fromEntries(summaryPairs));
    } catch (err) {
      console.error(err);
      setError("Could not load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clearVisionContext();
    loadEvents();
  }, []);

  const createEvent = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    try {
      setSaving(true);
      const { data } = await axios.post(apiPath("/api/events"), {
        ...form,
        starts_at: form.starts_at || null,
      });
      setForm(emptyForm);
      await loadEvents();
      navigate(`/events/${data._id}/dashboard`);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Could not create event.");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (event) => {
    const confirmed = window.confirm(`Delete event "${event.name}"? It will be removed from the active event list.`);
    if (!confirmed) return;

    try {
      await axios.delete(apiPath(`/api/events/${event._id}`));
      await loadEvents();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Could not delete event.");
    }
  };

  return (
    <div className="events-page">
      <header className="events-hero">
        <div>
          <p className="overline">PULAO</p>
          <h1>Events</h1>
          <p>Create one workspace per event, then manage that event's people, cameras, alerts, and evidence separately.</p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="events-layout">
        <form className="event-create-panel" onSubmit={createEvent}>
          <div className="module-header">
            <div>
              <p className="overline">New workspace</p>
              <h2>Create Event</h2>
            </div>
          </div>
          <div className="event-form-body">
            <label>
              Event name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Expo Day 1" required />
            </label>
            <label>
              Venue
              <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Main Hall" />
            </label>
            <label>
              Start date
              <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="live">Live</option>
              </select>
            </label>
            <label>
              Notes
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Access plan, operator notes, venue details" />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Creating..." : "Create and Open"}</button>
          </div>
        </form>

        <section className="events-list-panel">
          <div className="module-header">
            <div>
              <p className="overline">Workspaces</p>
              <h2>Open Events</h2>
            </div>
          </div>

          {loading ? (
            <div className="loading-spinner"><div className="spinner"></div></div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <h3>No events yet.</h3>
              <p>Create your first event to start building access lists and checkpoints.</p>
            </div>
          ) : (
            <div className="event-workspace-list">
              {events.map((event) => {
                const summary = summaries[event._id] || {};
                return (
                  <div key={event._id} className="event-workspace-row">
                    <span>
                      <strong>{event.name}</strong>
                      <small>{event.venue || "No venue"} - {event.status}</small>
                    </span>
                    <span>{summary.people ?? 0} people</span>
                    <span>{summary.cameras ?? 0} checkpoints</span>
                    <span>{summary.alerts ?? 0} alerts</span>
                    <span className="event-row-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => navigate(`/events/${event._id}/dashboard`)}>
                        Open
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => deleteEvent(event)}>
                        Delete
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </div>
  );
};

export default EventsPage;
