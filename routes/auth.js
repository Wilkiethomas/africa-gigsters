const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Tight limiter on auth attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' }
});

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ---- REGISTER ----
router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 60 }).withMessage('Name must be 2-60 characters.'),
    body('username').trim().isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username: letters, numbers, underscores only.'),
    body('email').isEmail().withMessage('Please enter a valid email.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const { name, username, email, password } = req.body;

      const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] });
      if (existing) {
        const field = existing.email === email.toLowerCase() ? 'email' : 'username';
        return res.status(409).json({ error: `That ${field} is already taken.` });
      }

      const user = await User.create({ name, username, email, password });
      const token = signToken(user._id);

      res.status(201).json({ token, user });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Could not create account. Please try again.' });
    }
  }
);

// ---- LOGIN ----
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Please enter a valid email.'),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const ok = await user.comparePassword(password);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const token = signToken(user._id);
      res.json({ token, user });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ---- CURRENT USER ----
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
