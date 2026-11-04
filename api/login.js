// POST /api/login  { email, password } → starts a session
import { db, ensureSchema } from '../lib/db.js';
import { body, normalizeEmail, onlyPost, publicUser, send, startSession, verifyPassword } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    await ensureSchema();
    const { email: rawEmail, password } = body(req);
    const email = normalizeEmail(rawEmail);
    const rows = await db()`
      SELECT id, email, name, plan, is_demo, created_at, password_hash FROM users WHERE email = ${email}`;
    const user = rows[0];
    const ok = user && typeof password === 'string' && (await verifyPassword(password, user.password_hash));
    if (!ok) return send(res, 401, { error: 'That email and password don’t match an account.' });

    await startSession(res, user.id);
    send(res, 200, { user: publicUser(user) });
  } catch (err) {
    console.error('login failed', err);
    send(res, 500, { error: 'Something went wrong logging in. Please try again.' });
  }
}
