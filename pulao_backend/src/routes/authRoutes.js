import express from 'express';
import { registerUser, getUserByUsername, loginUser } from '../controllers/authController.js';

const router = express.Router();

// Create a new user (Register)
router.post('/register', registerUser);

// Get user by username
router.get('/:username', getUserByUsername);

// POST /login route for authentication
router.post('/login', loginUser);

export default router;
