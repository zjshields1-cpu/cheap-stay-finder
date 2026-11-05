// Passwords, login sessions and small HTTP helpers for the /api functions.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'csf_session';
const SESSION_DAYS = 30;

// ---------- Passwords (scrypt, salted; only the hash is stored) ----------
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------- Sessions: random token in an HttpOnly cookie, its hash in the database ----------
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await db()`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, ${expires})`;
  await db()`UPDATE users SET last_login_at = now() WHERE id = ${userId}`;
  res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
}

export async function endSession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await db()`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  res.setHeader('Set-Cookie', cookie('', 0));
}

// The logged-in user for this request, or null
export async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db()`
    SELECT u.id, u.email, u.name, u.plan, u.is_demo, u.created_at,
           u.stripe_customer_id, u.subscription_status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`;
  return rows[0] || null;
}

export const publicUser = (u) => u && ({
  email: u.email, name: u.name, plan: u.plan, isPro: u.plan === 'pro', isDemo: u.is_demo, since: u.created_at,
  subscriptionStatus: u.subscription_status || null, hasBilling: !!u.stripe_customer_id,
});

// ---------- HTTP helpers ----------
export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export function onlyPost(req, res) {
  if (req.method === 'POST') return true;
  res.setHeader('Allow', 'POST');
  send(res, 405, { error: 'Use POST.' });
  return false;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
