const Order = require('../models/Order');
const User = require('../models/User');
const Gig = require('../models/Gig');

/**
 * Auto-complete service.
 *
 * Problem: a seller delivers, the buyer never responds. Without this,
 * the seller's money sits in escrow forever. Every marketplace solves
 * it the same way: deliveries auto-approve after a grace period.
 * Ours is 3 days (Fiverr uses 3 too).
 *
 * Pattern: a simple interval loop, same as the Federation's
 * reminderService. Runs hourly; work is idempotent.
 */
const AUTO_COMPLETE_DAYS = 3;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;   // hourly

async function autoCompleteDeliveredOrders() {
  try {
    const cutoff = new Date(Date.now() - AUTO_COMPLETE_DAYS * 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      status: 'delivered',
      'delivery.deliveredAt': { $lte: cutoff }
    });

    for (const order of orders) {
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

      console.log(`⏱ Order ${order.orderNumber} auto-completed after ${AUTO_COMPLETE_DAYS} days.`);
    }
  } catch (err) {
    console.error('Auto-complete service error:', err);
  }
}

function startOrderService() {
  // First run shortly after boot, then hourly
  setTimeout(autoCompleteDeliveredOrders, 30 * 1000);
  setInterval(autoCompleteDeliveredOrders, CHECK_INTERVAL_MS);
  console.log('🕐 Order auto-complete service started (3-day grace period).');
}

module.exports = { startOrderService };
