// POST /api/billing-portal → { url } of Stripe's page for updating the card or canceling
import { ensureSchema } from '../lib/db.js';
import { currentUser, onlyPost, send } from '../lib/auth.js';
import { siteOrigin, stripe } from '../lib/stripe.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: 'Log in first.', code: 'login' });
    if (!user.stripe_customer_id) return send(res, 400, { error: 'There’s no subscription on this account yet.' });

    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${siteOrigin(req)}/account`,
    });
    send(res, 200, { url: portal.url });
  } catch (err) {
    console.error('billing portal failed', err);
    const notSetUp = /configuration/i.test(err?.message || '');
    send(res, 500, {
      error: notSetUp
        ? 'Subscription management isn’t switched on in Stripe yet (Settings → Billing → Customer portal → Save).'
        : 'Couldn’t open subscription management. Please try again.',
    });
  }
}
