const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { adminOnly } = require('../middleware/auth');

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

// ---- BECOME A SELLER ----
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

// ---- SUBMIT VERIFICATION (seller -> pending) ----
router.post('/submit-verification', auth, async (req, res) => {
  try {
    if (!req.user.isSeller) {
      return res.status(403).json({ error: 'Activate your seller profile first.' });
    }
    if (req.user.verificationStatus === 'verified') {
      return res.status(400).json({ error: 'You are already verified.' });
    }
    if (req.user.verificationStatus === 'pending') {
      return res.status(400).json({ error: 'Your verification is already pending review.' });
    }

    const { phone, governmentIdType, governmentIdNumber, portfolioUrl, notes } = req.body;
    if (!phone || !governmentIdType || !governmentIdNumber) {
      return res.status(400).json({ error: 'Phone, ID type, and ID number are required.' });
    }

    req.user.verification = {
      phone,
      governmentIdType,
      governmentIdNumber,
      portfolioUrl: portfolioUrl || '',
      notes: notes || '',
      submittedAt: new Date(),
      reviewedAt: null,
      rejectionReason: ''
    };
    req.user.verificationStatus = 'pending';

    await req.user.save();
    res.json({ user: req.user });
  } catch (err) {
    console.error('Submit verification error:', err);
    res.status(500).json({ error: 'Could not submit verification.' });
  }
});

// ---- ADMIN: list pending verifications ----
router.get('/admin/verifications/pending', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find({ verificationStatus: 'pending' })
      .select('+verification.governmentIdNumber')  // admin can see the ID number
      .sort({ 'verification.submittedAt': 1 });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Could not load pending verifications.' });
  }
});

// ---- ADMIN: approve / reject a seller ----
router.post('/admin/verify/:userId', auth, adminOnly, async (req, res) => {
  try {
    const { decision, rejectionReason } = req.body;  // 'approve' | 'reject'
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'." });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.verificationStatus = decision === 'approve' ? 'verified' : 'rejected';
    user.verification.reviewedAt = new Date();
    user.verification.rejectionReason = decision === 'reject' ? (rejectionReason || '') : '';
    await user.save();

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Could not update verification.' });
  }
});

module.exports = router;
