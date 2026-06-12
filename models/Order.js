const mongoose = require('mongoose');

/**
 * Order — one purchase of one gig package.
 *
 * THE STATE MACHINE (the spine of the whole marketplace):
 *
 *  pending_payment ──(Stripe webhook)──▶ in_progress ──(seller delivers)──▶ delivered
 *        │                                   │                                │
 *        │ (session expired                  │ (buyer cancels                 ├─(buyer approves)──▶ completed
 *        │  or buyer abandons)               │  before delivery,              │                     [seller credited]
 *        ▼                                   │  refund issued)                └─(buyer requests
 *    cancelled ◀─────────────────────────────┘                                   revision)──▶ revision_requested
 *                                                                                                 │
 *                                                                                (seller re-delivers)──▶ delivered
 *
 * MONEY (all amounts in cents):
 *   amount         — what the buyer paid
 *   commission     — platform's cut (20%)
 *   sellerEarnings — amount minus commission, credited to seller.balance
 *                    ONLY when the order completes (that's the escrow).
 */

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },

  buyer:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gig:    { type: mongoose.Schema.Types.ObjectId, ref: 'Gig',  required: true },

  /**
   * SNAPSHOT of what was bought, frozen at purchase time.
   * The seller can edit or even delete the gig later — the order
   * must always show exactly what the buyer paid for.
   */
  gigSnapshot: {
    title:        String,
    slug:         String,
    image:        String,            // first gallery image at time of order
    packageTier:  String,            // basic | standard | premium
    packageTitle: String,
    packageDescription: String,
    deliveryDays: Number,
    revisions:    Number
  },

  // ---- Money (cents) ----
  amount:         { type: Number, required: true },
  commission:     { type: Number, required: true },
  sellerEarnings: { type: Number, required: true },

  // ---- Lifecycle ----
  status: {
    type: String,
    enum: ['pending_payment', 'in_progress', 'delivered',
           'revision_requested', 'completed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },

  // ---- Buyer's brief ----
  requirements: { type: String, maxlength: 3000, default: '' },

  // ---- Seller's delivery ----
  delivery: {
    message: { type: String, maxlength: 3000, default: '' },
    files:   [{ type: String }],          // URLs (R2)
    deliveredAt: { type: Date }
  },
  revisionsUsed: { type: Number, default: 0 },

  // ---- Stripe references ----
  stripeSessionId:       { type: String, index: true },
  stripePaymentIntentId: { type: String },

  // ---- Timeline ----
  paidAt:      { type: Date },
  dueAt:       { type: Date },             // paidAt + deliveryDays
  completedAt: { type: Date },
  cancelledAt: { type: Date }
}, { timestamps: true });

/** Human-friendly order number, e.g. AG-LX2K9-4F7Q */
orderSchema.statics.generateOrderNumber = function () {
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `AG-${t}-${r}`;
};

module.exports = mongoose.model('Order', orderSchema);
