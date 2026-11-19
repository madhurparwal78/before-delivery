// Resets the store to pristine seed state: drop, migrate, seed once.
import pool, { query } from '../lib/db.mjs';
import { migrate } from '../lib/db.mjs';
import { seed } from '../lib/seed.mjs';

async function main() {
  const drops = [
    'DROP TABLE IF EXISTS login_attempts, rating_audit, notifications, blocks, challenges, chat_messages, moves, games, club_memberships, clubs, sessions, members, avatars CASCADE',
  ];
  for (const d of drops) {
    try { await query(d); } catch (e) { console.error('drop:', e.message); }
  }
  await migrate();
  await seed();
  const counts = {};
  for (const t of ['members', 'games', 'moves', 'challenges', 'chat_messages', 'clubs', 'club_memberships', 'blocks', 'notifications', 'sessions']) {
    counts[t] = Number((await query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
  }
  console.log('reset complete:', JSON.stringify(counts));
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
