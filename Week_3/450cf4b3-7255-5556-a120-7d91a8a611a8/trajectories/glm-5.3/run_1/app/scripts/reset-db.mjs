#!/usr/bin/env node
// Dev helper: drop the app's tables so a fresh boot re-applies schema and seed.
import pg from 'pg';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(`
  DROP TABLE IF EXISTS
    booking_occupancies, ledger_entries, movements, notice_claims, mail_queue,
    idempotency_keys, purchase_attempts, door_log, documents, bookings, packs,
    counted_claims, sign_in_attempts, sessions, tenants, stations, users
  CASCADE
`);
await db.end();
console.log('db reset');
