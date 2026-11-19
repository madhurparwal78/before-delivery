'use strict';
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30000,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

async function all(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Run a function inside one transaction, so a write lands whole or not at all. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, all, tx };
