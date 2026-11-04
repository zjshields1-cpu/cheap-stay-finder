// POST /api/signup  { email, password, name? } → creates the account and logs it in
import { db, ensureSchema } from '../lib/db.js';
import { body, hashPassword, normalizeEmail, onlyPost, publicUser, send, startSession, validEmail } from '../lib/auth.js';

export default async function handler(req, res) {
  if (!onlyPost(req, res)) return;
  try {
    await ensureSchema();
    const { email: rawEmail, password, name } = body(req);
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8) {
      return send(res, 400, { error: 'Use a password with at least 8 characters.' });
    }
    if (password.length > 200) return send(res, 400, { error: 'That password is too long.' });
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) || null : null;

    const rows = await db()`
      INSERT INTO users (email, name, password_hash)
      VALUES (${email}, ${cleanName}, ${await hashPassword(password)})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, name, plan, is_demo, created_at`;
    if (!rows.length) return send(res, 409, { error: 'An account with that email already exists. Try logging in.' });

    await startSession(res, rows[0].id);
    send(res, 201, { user: publicUser(rows[0]) });
  } catch (err) {
    console.error('signup failed', err);
    send(res, 500, { error: 'Something went wrong creating your account. Please try again.' });
  }
}
