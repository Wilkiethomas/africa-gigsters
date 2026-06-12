const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Unified account model.
 * Every user can buy. Any user can become a seller by completing
 * their freelancer profile, which flips `isSeller` to true.
 *
 * Sellers must then be VERIFIED before they can publish gigs.
 * Verification flow: submit -> pending -> verified (or rejected) by admin.
 */
const userSchema = new mongoose.Schema({
  // ---- Core identity ----
  name: {
    type: String, required: true, trim: true, minlength: 2, maxlength: 60
  },
  username: {
    type: String, required: true, unique: true, trim: true, lowercase: true,
    minlength: 3, maxlength: 30,
    match: [/^[a-z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
  },
  email: {
    type: String, required: true, unique: true, trim: true, lowercase: true
  },
  password: {
    type: String, required: true, minlength: 6, select: false
  },

  // ---- Profile ----
  avatar: { type: String, default: '' },
  bio: { type: String, maxlength: 600, default: '' },
  country: { type: String, default: '' },
  languages: [{ type: String }],

  // ---- Seller (freelancer) profile ----
  isSeller: { type: Boolean, default: false },
  sellerProfile: {
    headline: { type: String, default: '' },
    skills: [{ type: String }],
    hourlyRate: { type: Number, default: 0 },
    level: {
      type: String,
      enum: ['new', 'level_1', 'level_2', 'top_rated'],
      default: 'new'
    },
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 }
  },

  // ---- Seller verification ----
  verificationStatus: {
    type: String,
    enum: ['unverified', 'pending', 'verified', 'rejected'],
    default: 'unverified'
  },
  verification: {
    phone:              { type: String, default: '' },
    governmentIdType:   { type: String, default: '' },
    governmentIdNumber: { type: String, default: '' },
    portfolioUrl:       { type: String, default: '' },
    notes:              { type: String, default: '' },
    submittedAt:        { type: Date },
    reviewedAt:         { type: Date },
    rejectionReason:    { type: String, default: '' }
  },

  // ---- Account / platform ----
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },   // seller earnings in CENTS

  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  // Never expose government ID numbers in API responses.
  if (obj.verification) delete obj.verification.governmentIdNumber;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
