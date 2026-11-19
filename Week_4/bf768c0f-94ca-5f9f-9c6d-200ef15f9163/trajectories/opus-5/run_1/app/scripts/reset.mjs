/**
 * Empty every table and lay the seed down again, so the club is exactly as
 * the brief describes it.  Used after local checking.
 */

import { pool, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';

await migrate();
await pool.query(`truncate table rating_audit, notifications, blocks, club_memberships, challenges,
  chat_messages, moves, games, sessions, login_attempts, clubs, members restart identity cascade`);
const counts = await seed();
console.log(JSON.stringify(counts));
const members = await pool.query('select username, rating, rated_games, role from members order by username');
for (const row of members.rows) {
  console.log(`${row.username}\t${row.rating}\t${row.rated_games}\t${row.role}`);
}
await pool.end();
