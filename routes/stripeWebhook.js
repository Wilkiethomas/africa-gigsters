const Stripe = require('stripe');
const Order = require('../models/Order');

/**
 * Stripe webhook handler.
 *
 * WHY THIS FILE IS SPECIAL:
 * Stripe signs every webhook with a secret. To verify the signature we need
 * the RAW request body — the exact bytes Stripe sent. If express.json() has
 * already parsed the body into an object, verification fails with
 * "No signatures found matching the expected signature."
 *
 * That's why server.js mounts this route with express.raw() BEFORE the
 * global express.json() middleware. Order of mounting is everything.
 *
 * WHY WEBHOOKS AT ALL:
 * After Stripe Checkout, the buyer gets redirected back to our success URL —
 * but redirects are unreliable (user closes the tab, network drops, etc.).
 * The webhook is Stripe's guaranteed server-to-server notification that
 * payment really happened. NEVER mark an order paid based on the redirect;
 * ONLY trust the webhook.
 */
module.exports = async function stripeWebhook(req, res) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  const stripe = new Stripe(stripeKey);

  let event;
  try {
    // req.body is a Buffer here (raw), exactly what Stripe needs
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      webhookSecret
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  try {
    switch (event.type) {

      // ---- Payment confirmed: the order becomes real ----
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.metadata && session.metadata.orderId;
        if (!orderId) break;

        const order = await Order.findById(orderId);
        if (!order) break;

        // Idempotency: webhooks can arrive more than once.
        // Only transition if we're still waiting for payment.
        if (order.status === 'pending_payment') {
          order.status = 'in_progress';
          order.paidAt = new Date();
          order.stripePaymentIntentId = session.payment_intent || '';
          const days = order.gigSnapshot.deliveryDays || 3;
          order.dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          await order.save();
          console.log(`✅ Order ${order.orderNumber} paid — now in progress.`);
        }
        break;
      }

      // ---- Buyer never paid: clean up the placeholder order ----
      case 'checkout.session.expired': {
        const session = event.data.object;
        const orderId = session.metadata && session.metadata.orderId;
        if (!orderId) break;

        const order = await Order.findById(orderId);
        if (order && order.status === 'pending_payment') {
          order.status = 'cancelled';
          order.cancelledAt = new Date();
          await order.save();
          console.log(`🗑 Order ${order.orderNumber} expired unpaid — cancelled.`);
        }
        break;
      }

      default:
        // Other events are fine to ignore — we only subscribed to what we need.
        break;
    }

    // Always 200 quickly: Stripe retries non-2xx responses for days.
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Return 500 so Stripe retries — our handler is idempotent, retries are safe.
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
};
