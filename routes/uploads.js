const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * Multer config: keep uploaded files in memory (we hand them straight to R2),
 * cap each file at 10 MB, and only accept image MIME types.
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
 * Lazy-init the R2 client. The server can boot fine without R2 credentials —
 * the upload routes will just refuse with a clean error until they're set.
 */
let s3 = null;
function getS3() {
  if (s3) return s3;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY || !process.env.R2_SECRET_KEY) {
    return null;
  }
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY
    }
  });
  return s3;
}

/**
 * Unique filename: timestamp-random.ext
 * Stops two users overwriting each other if they both upload "image.jpg",
 * and makes URLs unguessable (you can't sequentially scrape gig images).
 */
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
  // Path scheme: gigs/<userId>/<filename> — easy to attribute, easy to clean
  const key = `gigs/${userId}/${filename}`;

  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: 'public, max-age=31536000'  // cache for 1 year — images don't change
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/** Translate Multer's error codes into clean JSON errors for the user. */
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
      // Upload in parallel — much faster than sequentially for multiple files
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
