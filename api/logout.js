// POST /api/logout → ends the current session
import { endSession, onlyPost, send } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    await endSession(req, res);
    send(res, 200, { ok: true });
  } catch (err) {
    console.error('logout failed', err);
    send(res, 500, { error: 'Couldn’t log out. Please try again.' });
  }
}
