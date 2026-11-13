import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev' });
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
console.log('wiped');
await pool.end();

// Also clear the Gatecut counters so a wiped database starts clean.
import { createClient } from 'redis';
const url = process.env.VALKEY_URL ?? 'redis://app:gfkit-dev@valkey:6379/0';
const client = createClient({ url });
try {
  await client.connect();
  const keys = await client.keys('gatecut:*');
  if (keys.length > 0) await client.del(keys);
  console.log('counters cleared');
} catch {
  console.log('counters left as they are');
}
await client.disconnect().catch(() => undefined);
