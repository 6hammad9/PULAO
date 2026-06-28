// backend/routes/whitelistedRoutes.js
import express from 'express';
import { getWhitelistedCount, getWhitelistedDetails } from '../controllers/personController.js';

const router = express.Router();

// Route for the Dashboard Number
router.get('/count/total', getWhitelistedCount);

// Route for the Popup List
router.get('/', getWhitelistedDetails);

export default router;