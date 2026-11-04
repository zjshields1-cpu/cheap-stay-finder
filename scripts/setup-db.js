// Creates the database tables and the demo account, then lists the users.
// Run with: npm run db:setup   (reads DATABASE_URL from .env.local, made by `vercel env pull`)
import { db, ensureSchema } from '../lib/db.js';

await ensureSchema();
const users = await db()`SELECT id, email, plan, is_demo, created_at FROM users ORDER BY id`;
console.log(`Database ready. ${users.length} account(s):`);
for (const u of users) console.log(`  #${u.id}  ${u.email}  plan=${u.plan}${u.is_demo ? '  (demo)' : ''}  created ${u.created_at.toISOString()}`);
