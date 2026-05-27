const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// ---- PUBLIC PROFILE by username ----
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

// ---- UPDATE OWN PROFILE ----
router.put('/profile', auth, async (req, res) => {
  try {
    const allowed = ['name', 'bio', 'avatar', 'country', 'languages'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) req.user[field] = req.body[field];
    });
    await req.user.save();
    res.json({ user: req.user });
  } catch (err) {
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

// ---- BECOME A SELLER (activate freelancer profile) ----
router.post('/become-seller', auth, async (req, res) => {
  try {
    const { headline, skills, hourlyRate } = req.body;

    if (!headline || !Array.isArray(skills) || skills.length === 0) {
      return res.status(400).json({ error: 'A headline and at least one skill are required.' });
    }

    req.user.isSeller = true;
    req.user.sellerProfile.headline = headline;
    req.user.sellerProfile.skills = skills;
    if (hourlyRate !== undefined) req.user.sellerProfile.hourlyRate = hourlyRate;

    await req.user.save();
    res.json({ user: req.user });
  } catch (err) {
    res.status(500).json({ error: 'Could not activate seller profile.' });
  }
});

module.exports = router;
