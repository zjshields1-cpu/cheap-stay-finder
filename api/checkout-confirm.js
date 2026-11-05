// GET /api/checkout-confirm?session_id=… → turns Pro on right after Stripe redirects back,
// without waiting for the webhook. Only works for the logged-in owner of that checkout.
import { ensureSchema } from '../lib/db.js';
import { currentUser, publicUser, send } from '../lib/auth.js';
import { applySubscription, stripe } from '../lib/stripe.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: 'Log in to finish upgrading.', code: 'login' });
    const sessionId = String(req.query.session_id || '');
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return send(res, 400, { error: 'Missing checkout session.' });

    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.client_reference_id !== String(user.id)) return send(res, 403, { error: 'That checkout belongs to another account.' });
    if (session.status !== 'complete') return send(res, 200, { user: publicUser(user), pending: true });

    const sub = session.subscription;
    const updated = await applySubscription({
      userId: user.id,
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      subscriptionId: typeof sub === 'string' ? sub : sub?.id,
      status: typeof sub === 'string' ? 'active' : sub?.status || 'active',
    });
    send(res, 200, { user: publicUser({ ...user, plan: updated?.plan || user.plan }) });
  } catch (err) {
    console.error('checkout-confirm failed', err);
    send(res, 500, { error: 'Couldn’t confirm your payment yet. Refresh in a moment.' });
  }
}
