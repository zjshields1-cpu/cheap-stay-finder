// POST /api/stripe-webhook ← Stripe tells us about payments and subscription changes.
// The signature check (STRIPE_WEBHOOK_SECRET) proves the message really came from Stripe.
import { ensureSchema } from '../lib/db.js';
import { applySubscription, stripe } from '../lib/stripe.js';

export const config = { api: { bodyParser: false } }; // the signature is checked against the raw body

// Read the request stream directly. Never touch req.body here: on Vercel, reading it parses
// and re-serializes the JSON, and the signature would no longer match.
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Use POST.');
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe webhook signature check failed', err.message);
    return res.status(400).send('Invalid signature.');
  }

  try {
    await ensureSchema();
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription') break;
        let status = 'active';
        if (typeof obj.subscription === 'string') {
          status = (await stripe().subscriptions.retrieve(obj.subscription)).status;
        }
        const u = await applySubscription({
          userId: Number(obj.client_reference_id) || null,
          customerId: obj.customer, subscriptionId: obj.subscription, status,
        });
        console.log('checkout completed', u?.email, '→', u?.plan);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status;
        const u = await applySubscription({
          userId: Number(obj.metadata?.userId) || null,
          customerId: obj.customer, subscriptionId: obj.id, status,
        });
        console.log(event.type, u?.email, '→', u?.plan);
        break;
      }
      default:
        break; // other events are ignored
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe webhook handling failed', err);
    res.status(500).send('Webhook handler error.'); // Stripe will retry
  }
}
