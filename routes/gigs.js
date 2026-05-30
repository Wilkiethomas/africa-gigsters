const express = require('express');
const Gig = require('../models/Gig');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * Categories shipped with the platform.
 * (Stored here as a constant for now; a future lesson moves these to the DB
 *  so admins can edit them without redeploying.)
 */
const CATEGORIES = [
  { slug: 'graphic-design',   name: 'Graphic Design',         emoji: '🎨' },
  { slug: 'web-development',  name: 'Web Development',        emoji: '💻' },
  { slug: 'writing',          name: 'Writing & Translation',  emoji: '✍️' },
  { slug: 'video',            name: 'Video & Animation',      emoji: '🎬' },
  { slug: 'marketing',        name: 'Digital Marketing',      emoji: '📈' },
  { slug: 'music',            name: 'Music & Audio',          emoji: '🎙️' },
  { slug: 'mobile',           name: 'Mobile Apps',            emoji: '📱' },
  { slug: 'business',         name: 'Business',               emoji: '💼' }
];

/** Build a URL-safe slug from a gig title, with a short random suffix
 *  to guarantee uniqueness without an unsightly counter. */
function makeSlug(title) {
  const base = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/**
 * ROUTE ORDER MATTERS in Express.
 * Literal-path routes (/my, /categories, /seller/:username) MUST be declared
 * before the parameterised /:slug route — otherwise Express matches them
 * all as slugs.
 */

// ---------- READ (PUBLIC): browse the catalogue ----------
// GET /api/gigs?q=...&category=...&sort=recent|rating|popular&page=1&limit=20
router.get('/', async (req, res) => {
  try {
    const { q, category, sort = 'recent' } = req.query;
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const filter = { status: 'published' };
    if (category) filter.category = category;
    if (q) filter.$text = { $search: q };

    const sortMap = {
      recent:  { createdAt: -1 },
      rating:  { rating: -1, reviewCount: -1 },
      popular: { ordersCount: -1, views: -1 }
    };

    const gigs = await Gig.find(filter)
      .populate('seller', 'name username avatar country sellerProfile.level sellerProfile.rating')
      .sort(sortMap[sort] || sortMap.recent)
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Gig.countDocuments(filter);

    res.json({ gigs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Browse gigs error:', err);
    res.status(500).json({ error: 'Could not load gigs.' });
  }
});

// ---------- READ (AUTH): own gigs in all statuses ----------
router.get('/my', auth, async (req, res) => {
  try {
    const gigs = await Gig.find({ seller: req.user._id }).sort({ createdAt: -1 });
    res.json({ gigs });
  } catch (err) {
    res.status(500).json({ error: 'Could not load your gigs.' });
  }
});

// ---------- READ (PUBLIC): list categories ----------
router.get('/meta/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

// ---------- READ (PUBLIC): all of one seller's published gigs ----------
router.get('/seller/:username', async (req, res) => {
  try {
    const seller = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!seller) return res.status(404).json({ error: 'Seller not found.' });

    const gigs = await Gig.find({ seller: seller._id, status: 'published' })
      .sort({ createdAt: -1 });
    res.json({ gigs });
  } catch (err) {
    res.status(500).json({ error: 'Could not load gigs.' });
  }
});

// ---------- READ (PUBLIC): single gig by slug ----------
router.get('/:slug', async (req, res) => {
  try {
    const gig = await Gig.findOne({ slug: req.params.slug })
      .populate('seller', 'name username avatar bio country languages sellerProfile');

    if (!gig) return res.status(404).json({ error: 'Gig not found.' });

    // Only show published gigs to the public.
    // (Owners hit /api/gigs/my to see their drafts.)
    if (gig.status !== 'published') {
      return res.status(404).json({ error: 'Gig not found.' });
    }

    // Fire-and-forget view increment — never block the response on it.
    Gig.updateOne({ _id: gig._id }, { $inc: { views: 1 } }).catch(() => {});

    res.json({ gig });
  } catch (err) {
    res.status(500).json({ error: 'Could not load gig.' });
  }
});

// ---------- CREATE (AUTH): new draft gig ----------
router.post('/', auth, async (req, res) => {
  try {
    if (!req.user.isSeller) {
      return res.status(403).json({ error: 'Activate your seller profile first.' });
    }

    const {
      title, description, category, subcategory, tags,
      packages, faqs, requirements, images, video
    } = req.body;

    // Hand-validate the shape — Mongoose will catch the rest, but these
    // produce friendlier error messages.
    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required.' });
    }
    if (!Array.isArray(packages) || packages.length < 1 || packages.length > 3) {
      return res.status(400).json({ error: 'Provide 1 to 3 packages.' });
    }

    const gig = await Gig.create({
      seller: req.user._id,
      title,
      description,
      slug: makeSlug(title),
      category,
      subcategory: subcategory || '',
      tags: Array.isArray(tags) ? tags : [],
      packages,
      faqs: Array.isArray(faqs) ? faqs : [],
      requirements: Array.isArray(requirements) ? requirements : [],
      images: Array.isArray(images) ? images : [],
      video: video || '',
      status: 'draft'
    });

    res.status(201).json({ gig });
  } catch (err) {
    // Mongoose validation errors get a friendlier message
    if (err.name === 'ValidationError') {
      const first = Object.values(err.errors)[0];
      return res.status(400).json({ error: first.message });
    }
    console.error('Create gig error:', err);
    res.status(500).json({ error: 'Could not create gig.' });
  }
});

// ---------- UPDATE (AUTH): edit own gig ----------
router.put('/:id', auth, async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });
    if (!gig.seller.equals(req.user._id)) {
      return res.status(403).json({ error: 'This is not your gig.' });
    }

    const editable = [
      'title', 'description', 'category', 'subcategory', 'tags',
      'packages', 'faqs', 'requirements', 'images', 'video'
    ];
    editable.forEach(field => {
      if (req.body[field] !== undefined) gig[field] = req.body[field];
    });

    await gig.save();
    res.json({ gig });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const first = Object.values(err.errors)[0];
      return res.status(400).json({ error: first.message });
    }
    res.status(500).json({ error: 'Could not update gig.' });
  }
});

// ---------- PUBLISH (AUTH + verified): go live ----------
router.post('/:id/publish', auth, async (req, res) => {
  try {
    if (req.user.verificationStatus !== 'verified') {
      return res.status(403).json({
        error: 'Complete seller verification before publishing.',
        verificationStatus: req.user.verificationStatus
      });
    }

    const gig = await Gig.findById(req.params.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });
    if (!gig.seller.equals(req.user._id)) {
      return res.status(403).json({ error: 'This is not your gig.' });
    }

    // Sanity-check the gig has its essentials before it goes public
    if (!gig.packages || gig.packages.length === 0) {
      return res.status(400).json({ error: 'Add at least one package before publishing.' });
    }

    gig.status = 'published';
    await gig.save();
    res.json({ gig });
  } catch (err) {
    res.status(500).json({ error: 'Could not publish gig.' });
  }
});

// ---------- PAUSE / UNPAUSE (AUTH) ----------
router.post('/:id/pause', auth, async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });
    if (!gig.seller.equals(req.user._id)) {
      return res.status(403).json({ error: 'This is not your gig.' });
    }
    gig.status = gig.status === 'paused' ? 'published' : 'paused';
    await gig.save();
    res.json({ gig });
  } catch (err) {
    res.status(500).json({ error: 'Could not change gig status.' });
  }
});

// ---------- DELETE (AUTH) ----------
router.delete('/:id', auth, async (req, res) => {
  try {
    const gig = await Gig.findById(req.params.id);
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });
    if (!gig.seller.equals(req.user._id)) {
      return res.status(403).json({ error: 'This is not your gig.' });
    }
    await gig.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete gig.' });
  }
});

module.exports = router;
