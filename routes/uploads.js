const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * Multer config: memory storage, 10 MB cap, images only.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WebP images are allowed.'));
    }
  }
});

/**
 * Lazy-init the R2 client.
 *
 * IMPORTANT: For EU / FedRAMP buckets, Cloudflare requires a jurisdiction-
 * specific endpoint (e.g. <account>.eu.r2.cloudflarestorage.com). We pick
 * that up from the optional R2_JURISDICTION env var.
 */
let s3 = null;
function getS3() {
  if (s3) return s3;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY) {
    return null;
  }
  const jurisdiction = (process.env.R2_JURISDICTION || '').toLowerCase().trim();
  const sub = jurisdiction ? `${jurisdiction}.` : '';
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.${sub}r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY
    }
  });
  return s3;
}

/** Unique filename: timestamp-random.ext */
function generateFilename(originalName) {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const random = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${random}${ext}`;
}

/** Upload one file buffer to R2, return its public URL. */
async function uploadToR2(file, userId) {
  const client = getS3();
  if (!client) throw new Error('Image uploads are not configured on this server.');

  const filename = generateFilename(file.originalname);
  const key = `gigs/${userId}/${filename}`;

  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: 'public, max-age=31536000'
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/** Translate Multer's error codes into clean JSON errors. */
function handleMulterError(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') return 'Each image must be 10 MB or smaller.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
    return 'Too many images. Maximum is 5 per upload.';
  return err.message || 'Upload failed.';
}

// ---------- POST /api/uploads/image (single) ----------
router.post('/image', auth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    const errMsg = handleMulterError(err);
    if (errMsg) return res.status(400).json({ error: errMsg });
    if (!req.file) return res.status(400).json({ error: 'No image provided.' });

    try {
      const url = await uploadToR2(req.file, req.user._id);
      res.json({ url });
    } catch (e) {
      console.error('R2 upload error:', e);
      res.status(500).json({ error: e.message || 'Could not upload image.' });
    }
  });
});

// ---------- POST /api/uploads/images (up to 5) ----------
router.post('/images', auth, (req, res) => {
  upload.array('images', 5)(req, res, async (err) => {
    const errMsg = handleMulterError(err);
    if (errMsg) return res.status(400).json({ error: errMsg });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided.' });
    }

    try {
      const urls = await Promise.all(
        req.files.map(file => uploadToR2(file, req.user._id))
      );
      res.json({ urls });
    } catch (e) {
      console.error('R2 upload error:', e);
      res.status(500).json({ error: e.message || 'Could not upload images.' });
    }
  });
});

module.exports = router;
