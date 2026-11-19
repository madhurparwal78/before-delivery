import { Client } from 'pg';

const TABLES = [
  'change_feed',
  'idempotency_records',
  'outbox',
  'owner_sessions',
  'payment_transactions',
  'offers',
  'waitlist_entries',
  'tickets',
  'orders',
  'seats',
  'tiers',
  'performances',
  'settings',
];

async function run(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const table of TABLES) {
    await client.query(`drop table if exists ${table} cascade`);
  }
  await client.end();
  console.log('database cleared');
}

void run();
