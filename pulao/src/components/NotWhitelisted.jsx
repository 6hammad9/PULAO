import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import '../styles/NotWhitelisted.css';
import { apiPath } from '../config/api';

const NotWhitelisted = () => {
  const { eventId } = useParams();
  const [persons, setPersons] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchPersons();
  }, [eventId]);

  const fetchPersons = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(apiPath('/api/nonwhitelisted'), { params: { event_id: eventId } });
      setPersons(response.data);
    } catch (error) {
      console.error("API Error:", error);
      setError('Failed to load non-whitelisted persons. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const registerPerson = async (personId) => {
    try {
      const response = await axios.post(apiPath(`/register-person/register-from-log/${personId}`));
      alert(response.data.message);
      fetchPersons();
    } catch (err) {
      console.error("Registration error:", err);
      alert(err.response?.data?.error || "Failed to register person");
    }
  };

  const getImageUrl = (person) => {
    const image = person.image_url || person.image || '';
    if (!image) return '';
    if (/^https?:\/\//i.test(image)) return image;
    return apiPath(image.startsWith('/') ? image : `/${image}`);
  };

  return (
    <div className="not-whitelisted">
      <header className="review-header">
        <div>
          <p className="overline">Access review</p>
          <h1>Not Whitelisted Persons</h1>
          <p>Review unknown detections, verify the event context, and register approved people directly from the log.</p>
        </div>
      </header>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : error ? (
        <p className="error-message">{error}</p>
      ) : persons.length === 0 ? (
        <div className="empty-state">
          <h3>No non-whitelisted persons found.</h3>
          <p>New review items will appear here when the vision service flags an unknown person.</p>
        </div>
      ) : (
        <div className="review-card-grid">
          {persons.map((person) => {
            const date = new Date(person.date || person.time || Date.now());
            const imageUrl = getImageUrl(person);
            return (
              <article className="review-card" key={person._id}>
                <button
                  type="button"
                  className="review-image-button"
                  onClick={() => imageUrl && setSelectedPerson(person)}
                  disabled={!imageUrl}
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={person.name}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="review-muted">No image</span>
                  )}
                </button>

                <div className="review-card-body">
                  <div className="review-card-title">
                    <div>
                      <p className="overline">{person.findings || 'Not whitelisted'}</p>
                      <h2>{person.name}</h2>
                    </div>
                    <button className="btn btn-primary" onClick={() => registerPerson(person._id)}>Register</button>
                  </div>

                  <div className="review-facts">
                    <span><strong>Checkpoint</strong>{person.camera}</span>
                    <span><strong>Department</strong>{person.department}</span>
                    <span><strong>Section</strong>{person.section || 'None'}</span>
                    <span><strong>Detected</strong>{date.toLocaleString()}</span>
                    <span className="review-wide">
                      <strong>Allowed at</strong>
                      {person.allowed_checkpoints
                        ? person.allowed_checkpoints
                        : person.registered
                          ? 'No checkpoints'
                          : 'Not registered'}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedPerson && (
        <div className="review-lightbox" onClick={() => setSelectedPerson(null)}>
          <div className="review-lightbox-content" onClick={(event) => event.stopPropagation()}>
            <button className="review-lightbox-close" onClick={() => setSelectedPerson(null)}>&times;</button>
            <img src={getImageUrl(selectedPerson)} alt={selectedPerson.name} />
            <div>
              <h3>{selectedPerson.name}</h3>
              <p>{selectedPerson.camera} - {new Date(selectedPerson.date || selectedPerson.time || Date.now()).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotWhitelisted;
