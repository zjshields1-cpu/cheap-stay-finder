// GET /api/me → { user } for the logged-in visitor, or { user: null }
import { ensureSchema } from '../lib/db.js';
import { currentUser, publicUser, send } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    send(res, 200, { user: publicUser(await currentUser(req)) || null });
  } catch (err) {
    console.error('me failed', err);
    send(res, 500, { user: null, error: 'Couldn’t check your login right now.' });
  }
}
