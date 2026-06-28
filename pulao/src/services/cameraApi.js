// services/api.js
import axios from 'axios';
import { API_URL } from '../config/api';

const API_BASE_URL = API_URL;

const getAuthConfig = () => ({
  headers: {
    Authorization: `Bearer ${localStorage.getItem('token')}`
  }
});

const getRequestConfig = (eventId) => ({
  ...getAuthConfig(),
  params: eventId ? { event_id: eventId } : {},
});

export const fetchAllCounts = async (eventId) => {
  try {
    const [cameras, whitelisted, nonWhitelisted, unclearPictures] = await Promise.all([
      axios.get(`${API_BASE_URL}/cameras/count/total`, getRequestConfig(eventId)),
      axios.get(`${API_BASE_URL}/whitelisted/count/total`, getRequestConfig(eventId)),
      axios.get(`${API_BASE_URL}/nonwhitelisted/count`, getRequestConfig(eventId)),
      
    ]);

    return {
      cameras: cameras.data.count,
      whitelisted: whitelisted.data.count,
      nonWhitelisted: nonWhitelisted.data.count,
      
    };
  } catch (error) {
    console.error('Error fetching counts:', error);
    return null;
  }
};


export const fetchDetails = async (type, eventId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/${type}`, getRequestConfig(eventId));
     console.error(`response.data':`, response.data);
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${type} data:`, error);
    return [];
  }
};
