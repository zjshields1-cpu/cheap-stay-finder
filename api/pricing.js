// GET /api/pricing → the current Pro price, so every page shows what checkout will charge
import { PRO } from '../lib/stripe.js';

export default function handler(req, res) {
  const dollars = PRO.amountCents / 100;
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    cents: PRO.amountCents,
    currency: PRO.currency,
    interval: PRO.interval,
    display: `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`,
  });
}
