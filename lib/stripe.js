// Stripe client and Pro plan settings. Keys come from Vercel environment variables only.
import Stripe from 'stripe';
import { db } from './db.js';

export const PRO = {
  name: 'Cheap Stay Finder Pro',
  description: 'AI-built outdoor trips: a full day-by-day plan for your dates, budget and interests.',
  amountCents: 799,
  currency: 'usd',
  interval: 'month',
};

let client;
export function stripe() {
  if (!client) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set in Vercel.');
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

// The site's own address (works on the live domain and on preview deployments)
export function siteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Subscription states that keep Pro switched on
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

// Turn Pro on or off from a Stripe subscription. The demo account always stays Pro.
export async function applySubscription({ userId, customerId, subscriptionId, status }) {
  const plan = ACTIVE.has(status) ? 'pro' : 'free';
  const rows = await db()`
    UPDATE users SET
      plan = CASE WHEN is_demo THEN 'pro' ELSE ${plan} END,
      stripe_customer_id = COALESCE(${customerId ?? null}, stripe_customer_id),
      stripe_subscription_id = COALESCE(${subscriptionId ?? null}, stripe_subscription_id),
      subscription_status = ${status}
    WHERE id = COALESCE(${userId ?? null}::int,
                        (SELECT id FROM users WHERE stripe_subscription_id = ${subscriptionId ?? null} LIMIT 1),
                        (SELECT id FROM users WHERE stripe_customer_id = ${customerId ?? null} LIMIT 1))
    RETURNING id, email, plan`;
  return rows[0] || null;
}
