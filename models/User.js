const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Unified account model (Fiverr-style):
 * Every user can BUY. Any user can also "become a seller" by completing
 * their freelancer profile, which flips `isSeller` to true.
 * This keeps one identity per person instead of separate buyer/seller logins.
 */
const userSchema = new mongoose.Schema({
  // ---- Core identity ----
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 60
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
    match: [/^[a-z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false // never returned by default
  },

  // ---- Profile ----
  avatar: { type: String, default: '' },
  bio: { type: String, maxlength: 600, default: '' },
  country: { type: String, default: '' },          // marketplace-wide, Africa-focused
  languages: [{ type: String }],

  // ---- Seller (freelancer) profile ----
  isSeller: { type: Boolean, default: false },
  sellerProfile: {
    headline: { type: String, default: '' },        // e.g. "Logo & Brand Designer"
    skills: [{ type: String }],
    hourlyRate: { type: Number, default: 0 },        // optional, for hourly-style gigs
    level: {                                         // Fiverr-style seller tiers
      type: String,
      enum: ['new', 'level_1', 'level_2', 'top_rated'],
      default: 'new'
    },
    rating: { type: Number, default: 0 },            // avg of order reviews
    reviewCount: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 }
  },

  // ---- Account / platform ----
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isVerified: { type: Boolean, default: false },     // ID/email verification later
  balance: { type: Number, default: 0 },             // seller earnings (in cents), payouts later

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare a candidate password against the stored hash
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip sensitive fields from any JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
