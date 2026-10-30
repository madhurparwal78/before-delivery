'use strict';

const pg = require('pg');
const { Pool } = require('pg');

// Stop dates stay as plain YYYY-MM-DD strings end to end.
pg.types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

// A write transaction that serializes against any other write, so simultaneous
// posts cannot interleave reads and writes on the same rows.
async function writeTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gigfreight-write'))");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, writeTransaction };
