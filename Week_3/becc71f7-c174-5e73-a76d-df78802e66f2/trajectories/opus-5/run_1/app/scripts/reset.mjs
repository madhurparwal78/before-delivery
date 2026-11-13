// Empties this copy's database schema and clears Mailpit, for a fresh check run.
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
await pool.end();

await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' }).catch(
  () => undefined,
);

console.log('reset');
