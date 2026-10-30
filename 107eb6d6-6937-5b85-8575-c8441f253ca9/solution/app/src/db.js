'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');
const config = require('./config');

// DATE columns stay calendar strings (YYYY-MM-DD); never shifted through a timezone.
types.setTypeParser(1082, (value) => value);

// Timeouts turn an unreachable or stalled database into a prompt 503 instead of a hang.
const pool = new Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 3000, query_timeout: 10000 });
pool.on('error', () => { /* an idle client dropped; the next query reconnects */ });

function query(text, params) {
  return pool.query(text, params);
}

// Run fn(client) in one transaction. Any throw rolls everything back, so a refusal
// leaves the store exactly as it was.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Set once the schema and the seed are applied; health reports ok only after that.
const readiness = { ready: false };

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

async function migrate() {
  await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4173001)');
    await client.query("SET LOCAL client_min_messages = 'warning'");
    await client.query(SCHEMA);
  });
}

module.exports = { query, tx, migrate, readiness };
