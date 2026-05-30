const mongoose = require('mongoose');

/**
 * Package — a pricing tier inside a Gig.
 * Sellers can offer 1, 2, or 3 packages (basic / standard / premium).
 * One package = flat-price gig. Three packages = full Fiverr-style tiers.
 */
const packageSchema = new mongoose.Schema({
  tier: {
    type: String,
    enum: ['basic', 'standard', 'premium'],
    required: true
  },
  title: { type: String, required: true, maxlength: 50 },
  description: { type: String, required: true, maxlength: 500 },
  price: { type: Number, required: true, min: 500 },   // in cents — min $5.00
  deliveryDays: { type: Number, required: true, min: 1, max: 90 },
  revisions: { type: Number, default: 1, min: 0, max: 20 },
  features: [{ type: String, maxlength: 100 }]
}, { _id: false });

const gigSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // ---- Core listing ----
  title: { type: String, required: true, trim: true, minlength: 15, maxlength: 80 },
  description: { type: String, required: true, minlength: 100, maxlength: 1200 },
  slug: { type: String, required: true, unique: true, index: true },

  category: { type: String, required: true, index: true },
  subcategory: { type: String, default: '' },
  tags: [{ type: String, lowercase: true, trim: true }],

  // ---- Media (URLs — Cloudflare R2 in a future lesson) ----
  images: [{ type: String }],
  video: { type: String, default: '' },

  // ---- Packages: 1–3 tiers ----
  packages: {
    type: [packageSchema],
    validate: {
      validator: (v) => v.length >= 1 && v.length <= 3,
      message: 'A gig must have between 1 and 3 packages.'
    }
  },

  // ---- Optional extras (Fiverr-style) ----
  faqs: [{
    question: { type: String, maxlength: 200 },
    answer:   { type: String, maxlength: 500 }
  }],
  requirements: [{ type: String, maxlength: 300 }],  // questions seller asks the buyer

  // ---- Lifecycle ----
  status: {
    type: String,
    enum: ['draft', 'published', 'paused'],
    default: 'draft',
    index: true
  },

  // ---- Stats (updated by other systems later) ----
  views:        { type: Number, default: 0 },
  ordersCount:  { type: Number, default: 0 },
  rating:       { type: Number, default: 0 },
  reviewCount:  { type: Number, default: 0 }
}, { timestamps: true });

// Full-text search across title, description, tags.
// Mongo will build a search index for fast keyword queries.
gigSchema.index({ title: 'text', description: 'text', tags: 'text' });

// Virtual: lowest package price (so the catalog can show "starting at $X")
gigSchema.virtual('startingPrice').get(function () {
  if (!this.packages || this.packages.length === 0) return 0;
  return Math.min(...this.packages.map(p => p.price));
});

// Include virtuals in JSON responses
gigSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Gig', gigSchema);
