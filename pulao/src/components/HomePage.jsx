import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../styles/HomePage.css';
import DetailsPopup from './homepage/DetailsPopup';
import { fetchAllCounts, fetchDetails } from '../services/cameraApi';

const HomePage = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [counts, setCounts] = useState({
    cameras: 0,
    whitelisted: 0,
    nonWhitelisted: 0,
    unclearPictures: 0,
  });
  const [selectedData, setSelectedData] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [popupTitle, setPopupTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const events = [
    { name: 'Corporate Entry Check', date: 'Today', zones: 4, state: 'Live' },
    { name: 'Warehouse Night Shift', date: 'Tomorrow', zones: 3, state: 'Draft' },
    { name: 'VIP Reception', date: 'Friday', zones: 5, state: 'Scheduled' },
  ];

  const zones = [
    { name: 'Main Gate', camera: 'IP camera', rule: 'Allowed people enter', state: 'Online', allowed: counts.whitelisted, review: counts.unclearPictures },
    { name: 'VIP Lounge', camera: 'Mobile checkpoint', rule: 'Allowed people with ID', state: 'Ready', allowed: 18, review: 2 },
    { name: 'Staff Entry', camera: 'Laptop camera', rule: 'Staff list only', state: 'Online', allowed: 28, review: 0 },
    { name: 'Restricted Area', camera: 'Guard phone', rule: 'Manual approval', state: 'Operator needed', allowed: 0, review: counts.nonWhitelisted },
  ];

  const accessRules = [
    { name: 'Allowed', count: counts.whitelisted, description: 'Can enter assigned zones' },
    { name: 'ID required', count: 18, description: 'Known person, operator checks ID' },
    { name: 'Needs review', count: counts.unclearPictures, description: 'Unknown or low confidence' },
    { name: 'Restricted', count: counts.nonWhitelisted, description: 'Do not allow without approval' },
  ];

  const decisions = [
    { person: 'Hammad Naseer', zone: 'Main Gate', result: 'Allowed', time: 'Live' },
    { person: 'Unknown visitor', zone: 'VIP Lounge', result: 'Needs review', time: '1 min ago' },
    { person: 'Contractor pass', zone: 'Staff Entry', result: 'ID required', time: '4 min ago' },
    { person: 'Restricted match', zone: 'Restricted Area', result: 'Blocked', time: '8 min ago' },
  ];

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const data = await fetchAllCounts(eventId);
        if (data) {
          setCounts({
            cameras: data.cameras || 0,
            whitelisted: data.whitelisted || 0,
            nonWhitelisted: data.nonWhitelisted || 0,
            unclearPictures: data.unclearPictures || 0,
          });
        }
      } catch (err) {
        console.error('Error fetching counts:', err);
        setError('Failed to load dashboard statistics.');
      }
    };
    loadCounts();
  }, [eventId]);

  const handleDetails = async (type) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchDetails(type, eventId);
      setSelectedData(data || []);

      const titles = {
        cameras: 'Active Checkpoints',
        whitelisted: 'Allowed People',
        nonwhitelisted: 'Restricted Events',
        unclear: 'Needs Review',
      };

      setPopupTitle(titles[type] || type);
      setShowPopup(true);
    } catch (err) {
      console.error(err);
      setError('Failed to load details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page">
      <header className="workbench-header">
        <div>
          <p className="overline">PULAO</p>
          <h1>Access operations</h1>
          <p className="page-note">Create an event, divide it into zones, assign people, then connect cameras or consented phones.</p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('/events')} className="button button-primary">Switch event</button>
          <button onClick={() => navigate(`/events/${eventId}/people`)} className="button">Manage people</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="summary-strip" aria-label="Operation summary">
        <button onClick={() => handleDetails('cameras')}>
          <span>Checkpoints</span>
          <strong>{counts.cameras}</strong>
        </button>
        <button onClick={() => handleDetails('whitelisted')}>
          <span>Allowed people</span>
          <strong>{counts.whitelisted}</strong>
        </button>
        <button onClick={() => handleDetails('unclear')}>
          <span>Needs review</span>
          <strong>{counts.unclearPictures}</strong>
        </button>
        <button onClick={() => handleDetails('nonwhitelisted')}>
          <span>Restricted</span>
          <strong>{counts.nonWhitelisted}</strong>
        </button>
      </section>

      <main className="ops-grid">
        <section className="module events-module">
          <div className="module-header">
            <div>
              <p className="overline">Events</p>
              <h2>Current workspace</h2>
            </div>
            <button onClick={() => navigate('/events')} className="text-button">All events</button>
          </div>
          <div className="event-list">
            {events.map((event, index) => (
              <button key={event.name} className={index === 0 ? 'event-row active' : 'event-row'}>
                <span>
                  <strong>{event.name}</strong>
                  <small>{event.date}</small>
                </span>
                <span>{event.zones} zones</span>
                <span>{event.state}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="module zones-module">
          <div className="module-header">
            <div>
              <p className="overline">Zones</p>
              <h2>Corporate Entry Check</h2>
            </div>
            <button onClick={() => navigate(`/events/${eventId}/checkpoints`)} className="text-button">Add zone</button>
          </div>
          <div className="zone-table">
            <div className="table-head">
              <span>Zone</span>
              <span>Camera</span>
              <span>Rule</span>
              <span>Status</span>
              <span>Review</span>
            </div>
            {zones.map((zone) => (
              <div key={zone.name} className="table-row">
                <strong>{zone.name}</strong>
                <span>{zone.camera}</span>
                <span>{zone.rule}</span>
                <span>{zone.state}</span>
                <span>{zone.review}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="side-stack">
          <section className="module">
            <div className="module-header compact">
              <div>
                <p className="overline">Policy</p>
                <h2>Access rules</h2>
              </div>
            </div>
            <div className="rule-stack">
              {accessRules.map((rule) => (
                <div key={rule.name} className="rule-row">
                  <div>
                    <strong>{rule.name}</strong>
                    <span>{rule.description}</span>
                  </div>
                  <b>{rule.count}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="module">
            <div className="module-header compact">
              <div>
                <p className="overline">Actions</p>
                <h2>Operator queue</h2>
              </div>
            </div>
            <div className="queue-list">
              <button>Invite mobile checkpoint operator</button>
              <button>Assign VIP Lounge access list</button>
              <button>Review unknown detections</button>
            </div>
          </section>
        </aside>
      </main>

      <section className="module decision-module">
        <div className="module-header">
          <div>
            <p className="overline">Access log</p>
            <h2>Recent decisions</h2>
          </div>
          <button onClick={() => navigate(`/events/${eventId}/gallery`)} className="text-button">Open evidence</button>
        </div>
        <div className="decision-table">
          <div className="table-head">
            <span>Person</span>
            <span>Zone</span>
            <span>Decision</span>
            <span>Time</span>
          </div>
          {decisions.map((decision) => (
            <div key={`${decision.person}-${decision.time}`} className="table-row">
              <strong>{decision.person}</strong>
              <span>{decision.zone}</span>
              <span>{decision.result}</span>
              <span>{decision.time}</span>
            </div>
          ))}
        </div>
      </section>

      {showPopup && <DetailsPopup data={selectedData} onClose={() => setShowPopup(false)} title={popupTitle} />}

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <span>Loading...</span>
        </div>
      )}
    </div>
  );
};

export default HomePage;
