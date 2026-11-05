// POST /api/checkout → { url } of a Stripe Checkout page for the Pro subscription
import { db, ensureSchema } from '../lib/db.js';
import { currentUser, onlyPost, send } from '../lib/auth.js';
import { PRO, siteOrigin, stripe } from '../lib/stripe.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: 'Log in first, then upgrade.', code: 'login' });
    if (user.plan === 'pro') return send(res, 409, { error: 'You already have Pro.', code: 'already_pro' });

    // One Stripe customer per account, created the first time they check out
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: String(user.id) },
      });
      customerId = customer.id;
      await db()`UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${user.id}`;
    }

    const origin = siteOrigin(req);
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(user.id),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: PRO.currency,
          unit_amount: PRO.amountCents,
          recurring: { interval: PRO.interval },
          product_data: { name: PRO.name, description: PRO.description },
        },
      }],
      subscription_data: { metadata: { userId: String(user.id) } },
      metadata: { userId: String(user.id) },
      allow_promotion_codes: true,
      success_url: `${origin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account?checkout=canceled`,
    });
    send(res, 200, { url: session.url });
  } catch (err) {
    console.error('checkout failed', err);
    send(res, 500, { error: 'Couldn’t start checkout. Please try again in a minute.' });
  }
}
