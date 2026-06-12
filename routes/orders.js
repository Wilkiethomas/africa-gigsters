const express = require('express');
const Stripe = require('stripe');
const Order = require('../models/Order');
const Gig = require('../models/Gig');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

/** Platform commission: 20% (Fiverr-standard). */
const COMMISSION_RATE = 0.20;

/** Lazy Stripe init — server boots fine without keys; order routes refuse cleanly. */
let stripe = null;
function getStripe() {
  if (stripe) return stripe;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe;
}

function platformUrl() {
  return process.env.PLATFORM_URL || 'https://africagigsters.com';
}

/** Is this user a participant (buyer or seller) on this order? */
function isParticipant(order, userId) {
  return order.buyer.equals(userId) || order.seller.equals(userId);
}

// =====================================================================
// CHECKOUT — create the order + Stripe Checkout session
// =====================================================================
router.post('/checkout', auth, async (req, res) => {
  try {
    const s = getStripe();
    if (!s) return res.status(503).json({ error: 'Payments are not configured on this server yet.' });

    const { gigSlug, tier } = req.body;
    if (!gigSlug || !tier) {
      return res.status(400).json({ error: 'gigSlug and tier are required.' });
    }

    const gig = await Gig.findOne({ slug: gigSlug, status: 'published' })
      .populate('seller', 'name username');
    if (!gig) return res.status(404).json({ error: 'Gig not found.' });

    if (gig.seller._id.equals(req.user._id)) {
      return res.status(400).json({ error: 'You cannot order your own gig.' });
    }

    const pkg = gig.packages.find(p => p.tier === tier);
    if (!pkg) return res.status(404).json({ error: 'Package not found on this gig.' });

    // ---- Money math (cents, integers, no floats) ----
    const amount = pkg.price;
    const commission = Math.round(amount * COMMISSION_RATE);
    const sellerEarnings = amount - commission;

    // ---- Create the order in pending_payment ----
    const order = await Order.create({
      orderNumber: Order.generateOrderNumber(),
      buyer: req.user._id,
      seller: gig.seller._id,
      gig: gig._id,
      gigSnapshot: {
        title: gig.title,
        slug: gig.slug,
        image: (gig.images && gig.images[0]) || '',
        packageTier: pkg.tier,
        packageTitle: pkg.title,
        packageDescription: pkg.description,
        deliveryDays: pkg.deliveryDays,
        revisions: pkg.revisions
      },
      amount,
      commission,
      sellerEarnings,
      status: 'pending_payment'
    });

    // ---- Create the Stripe Checkout session ----
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${gig.title} — ${pkg.tier} package`,
            description: pkg.title
          },
          unit_amount: amount
        },
        quantity: 1
      }],
      metadata: { orderId: order._id.toString() },
      success_url: `${platformUrl()}/?order=success&num=${order.orderNumber}`,
      cancel_url: `${platformUrl()}/?order=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60   // 30-minute window
    });

    order.stripeSessionId = session.id;
    await order.save();

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// =====================================================================
// READ — my orders (as buyer or seller)
// =====================================================================
router.get('/my', auth, async (req, res) => {
  try {
    const role = req.query.role === 'seller' ? 'seller' : 'buyer';
    const filter = role === 'seller'
      ? { seller: req.user._id, status: { $ne: 'pending_payment' } }
      : { buyer: req.user._id };

    const orders = await Order.find(filter)
      .populate('buyer', 'name username avatar')
      .populate('seller', 'name username avatar')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

// =====================================================================
// READ — single order (participants only)
// =====================================================================
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'name username avatar')
      .populate('seller', 'name username avatar');

    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!isParticipant(order, req.user._id)) {
      return res.status(403).json({ error: 'This is not your order.' });
    }

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: 'Could not load order.' });
  }
});

// =====================================================================
// REQUIREMENTS — buyer submits/updates the brief
// =====================================================================
router.post('/:id/requirements', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.buyer.equals(req.user._id)) {
      return res.status(403).json({ error: 'Only the buyer can submit requirements.' });
    }
    if (!['in_progress', 'revision_requested'].includes(order.status)) {
      return res.status(400).json({ error: 'Requirements can only be added to an active order.' });
    }

    order.requirements = (req.body.requirements || '').slice(0, 3000);
    await order.save();
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: 'Could not save requirements.' });
  }
});

// =====================================================================
// DELIVER — seller submits the work
// =====================================================================
router.post('/:id/deliver', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.seller.equals(req.user._id)) {
      return res.status(403).json({ error: 'Only the seller can deliver.' });
    }
    if (!['in_progress', 'revision_requested'].includes(order.status)) {
      return res.status(400).json({ error: 'This order is not awaiting delivery.' });
    }

    const { message, files } = req.body;
    if (!message || message.trim().length < 10) {
      return res.status(400).json({ error: 'Include a delivery message (at least 10 characters).' });
    }

    order.delivery = {
      message: message.trim().slice(0, 3000),
      files: Array.isArray(files) ? files.slice(0, 10) : [],
      deliveredAt: new Date()
    };
    order.status = 'delivered';
    await order.save();

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: 'Could not submit delivery.' });
  }
});

// =====================================================================
// APPROVE — buyer accepts the delivery → ESCROW RELEASES
// =====================================================================
router.post('/:id/approve', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.buyer.equals(req.user._id)) {
      return res.status(403).json({ error: 'Only the buyer can approve a delivery.' });
    }
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'There is no delivery to approve.' });
    }

    // ---- THE ESCROW RELEASE ----
    // This is the moment the seller actually earns the money.
    order.status = 'completed';
    order.completedAt = new Date();
    await order.save();

    await User.findByIdAndUpdate(order.seller, {
      $inc: {
        balance: order.sellerEarnings,
        'sellerProfile.completedOrders': 1
      }
    });

    await Gig.findByIdAndUpdate(order.gig, { $inc: { ordersCount: 1 } });

    res.json({ order });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Could not approve the delivery.' });
  }
});

// =====================================================================
// REVISION — buyer requests changes (if revisions remain)
// =====================================================================
router.post('/:id/revision', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.buyer.equals(req.user._id)) {
      return res.status(403).json({ error: 'Only the buyer can request a revision.' });
    }
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'There is no delivery to revise.' });
    }
    if (order.revisionsUsed >= (order.gigSnapshot.revisions || 0)) {
      return res.status(400).json({
        error: `This package includes ${order.gigSnapshot.revisions} revision(s), all used. You can approve the delivery or contact the seller.`
      });
    }

    const note = (req.body.note || '').trim();
    if (!note || note.length < 10) {
      return res.status(400).json({ error: 'Describe what needs to change (at least 10 characters).' });
    }

    order.revisionsUsed += 1;
    order.status = 'revision_requested';
    // Append the revision note to requirements so the seller sees it in one place
    order.requirements = (order.requirements + `\n\n— REVISION REQUEST ${order.revisionsUsed} —\n` + note).slice(0, 3000);
    await order.save();

    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: 'Could not request a revision.' });
  }
});

// =====================================================================
// CANCEL — buyer cancels before delivery → full refund
// =====================================================================
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const s = getStripe();
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.buyer.equals(req.user._id)) {
      return res.status(403).json({ error: 'Only the buyer can cancel.' });
    }
    if (order.status !== 'in_progress') {
      return res.status(400).json({ error: 'Only orders awaiting delivery can be cancelled.' });
    }

    // Refund the full amount via Stripe
    if (s && order.stripePaymentIntentId) {
      await s.refunds.create({ payment_intent: order.stripePaymentIntentId });
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    await order.save();

    res.json({ order });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Could not cancel the order. If this persists, contact support.' });
  }
});

module.exports = router;
