/**
 * Africa Gigsters - Main Server
 * Serves both the REST API and the frontend SPA.
 *
 * Stack: Node.js 18 + Express + MongoDB Atlas (Mongoose) + JWT
 * Deploy: GitHub -> Hostinger auto-deploy. Restart app from hPanel after deploy.
 */

const path = require('path');
// IMPORTANT: load .env from this folder explicitly.
// (On Hostinger the working directory isn't always the app root,
//  which is what bit us on the Federation.)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ---- Safe fallbacks so the server never hard-crashes on a missing var ----
process.env.JWT_SECRET = process.env.JWT_SECRET || 'Gigsters_Dev_Secret_CHANGE_ME';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const PORT = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1); // needed for correct rate-limit IPs behind Hostinger proxy

// ===================
// SECURITY MIDDLEWARE
// ===================
app.use(helmet({
  contentSecurityPolicy: false,      // we serve our own inline frontend
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter (generous). Auth routes get a tighter one inside auth.js.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down and try again shortly.' }
});
app.use('/api/', globalLimiter);

// ===================
// DATABASE
// ===================
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err.message));

// ===================
// API ROUTES
// ===================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/gigs', require('./routes/gigs'));
app.use('/api/uploads', require('./routes/uploads'));

// Health / debug endpoint — confirms env vars are actually loading on the server.
app.get('/api/debug', (req, res) => {
  res.json({
    status: 'ok',
    node: process.version,
    env: {
      MONGODB_URI: !!process.env.MONGODB_URI,
      JWT_SECRET: process.env.JWT_SECRET !== 'Gigsters_Dev_Secret_CHANGE_ME',
      NODE_ENV: process.env.NODE_ENV
    },
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

// ===================
// FRONTEND (SPA)
// ===================
app.use(express.static(path.join(__dirname, 'public')));

// Send index.html for any non-API route (SPA client-side routing)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================
// ERROR HANDLER
// ===================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Africa Gigsters server running on port ${PORT}`);
});
