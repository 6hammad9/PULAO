// import User from '../models/User.js';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken'; // Import JWT
// import dotenv from 'dotenv';

// // Register new user
// export const registerUser = async (req, res) => {
//   try {
//     const { username, email, password } = req.body;

//     // Check if the user already exists
//     const existingUser = await User.findOne({ username });
//     if (existingUser) {
//       return res.status(400).json({ message: 'Username already exists' });
//     }

//     // Hash the password
//     const hashedPassword = await bcrypt.hash(password, 10);

//     // Create a new user
//     const newUser = new User({
//       username,
//       email,
//       password: hashedPassword,
//     });

//     await newUser.save();
//     res.status(201).json({ message: 'User created successfully!' });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // Get user by username
// export const getUserByUsername = async (req, res) => {
//   try {
//     const user = await User.findOne({ username: req.params.username }).select('-password'); // Exclude password
//     if (!user) {
//       return res.status(404).json({ message: 'User not found' });
//     }
//     res.json(user);
//   } catch (error) {
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// // Login user
// export const loginUser = async (req, res) => {
//   try {
//     const { username, password } = req.body;

//     // Find user by username
//     const user = await User.findOne({ username });
//     if (!user) {
//       console.log('User not found:', username);  // Log when user is not found
//       return res.status(404).json({ message: 'User not found' });
//     }

//     // Compare password with hashed password
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       console.log('Password mismatch');  // Log when password doesn't match
//       return res.status(400).json({ message: 'Invalid credentials' });
//     }

//     // Generate JWT token
//     const token = jwt.sign(
//       { userId: user._id, username: user.username },
//       process.env.JWT_SECRET_KEY || 'Faouzia',
      
//       { expiresIn: '1h' }
//     );
//     console.log(process.env.JWT_SECRET_KEY);
//     // Send response with token
//     res.status(200).json({ message: 'Login successful!', token });
//   } catch (error) {
//     console.error('Error during login:', error.message);  // Log any errors
//     res.status(500).json({ message: error.message });
//   }
// };
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

// Register new user
export const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if the user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();
    res.status(201).json({ message: 'User created successfully!' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user by username
export const getUserByUsername = async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('-password'); // Exclude password
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Login user
export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user by username
    const user = await User.findOne({ username });
    if (!user) {
      console.log('User not found:', username);  // Log when user is not found
      return res.status(404).json({ message: 'User not found' });
    }

    // Compare password with hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch');  // Log when password doesn't match
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Send success response without a token
    res.status(200).json({ message: 'Login successful!' });
  } catch (error) {
    console.error('Error during login:', error.message);  // Log any errors
    res.status(500).json({ message: error.message });
  }
};