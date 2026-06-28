// import jwt from 'jsonwebtoken';
// import dotenv from 'dotenv';

// dotenv.config(); // Load environment variables

// const JWT_SECRET = process.env.JWT_SECRET; // Use from .env

// export const authenticateToken = (req, res, next) => {
//   const token = req.header('Authorization');

//   if (!token || !token.startsWith('Bearer ')) {
//     return res.status(401).json({ message: 'Access denied. No valid token provided.' });
//   }

//   try {
//     const decoded = jwt.verify(token.split(' ')[1], JWT_SECRET);
//     req.user = decoded; // Attach user data to request
//     next();
//   } catch (error) {
//     res.status(403).json({ message: 'Invalid or expired token' });
//   }
// };
