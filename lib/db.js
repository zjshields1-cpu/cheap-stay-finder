// Neon Postgres connection + schema. The connection string comes from Vercel's Neon
// integration (DATABASE_URL) and is never stored in the code.
import { neon } from '@neondatabase/serverless';
import { hashPassword } from './auth.js';

const DEMO_EMAIL = 'demo@demo.com';
const DEMO_PASSWORD = 'password123!'; // published in the class assignment on purpose: graders log in with it

let sqlClient;
export function db() {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Connect a Neon database to the Vercel project.');
    sqlClient = neon(url);
  }
  return sqlClient;
}

// Creates the tables on first use and makes sure the demo account exists with Pro access.
let ready;
export function ensureSchema() {
  ready ??= (async () => {
    const sql = db();
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT,
        password_hash TEXT NOT NULL,
        plan          TEXT NOT NULL DEFAULT 'free',
        is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS ai_plans (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        destination   TEXT,
        model         TEXT,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        searches      INTEGER,
        status        TEXT NOT NULL DEFAULT 'started',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS ai_plans_user_day_idx ON ai_plans(user_id, created_at)`;

    const existing = await sql`SELECT id FROM users WHERE email = ${DEMO_EMAIL}`;
    if (!existing.length) {
      await sql`
        INSERT INTO users (email, name, password_hash, plan, is_demo)
        VALUES (${DEMO_EMAIL}, 'Demo User', ${await hashPassword(DEMO_PASSWORD)}, 'pro', TRUE)
        ON CONFLICT (email) DO NOTHING`;
    } else {
      await sql`UPDATE users SET plan = 'pro', is_demo = TRUE WHERE email = ${DEMO_EMAIL}`;
    }
  })().catch((err) => {
    ready = null; // try again on the next request
    throw err;
  });
  return ready;
}
