'use strict';

// The one PostgreSQL pool. The app never holds more than MAX_CONNECTIONS
// connections, for requests, streams, posting, expiry and schema work alike.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const errors = require('./errors');

const MAX_CONNECTIONS = 10;
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: MAX_CONNECTIONS,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 4000,
  query_timeout: 15000,
  statement_timeout: 15000,
  keepAlive: true,
  allowExitOnIdle: false,
});

// A dead connection must never crash the process; the pool replaces it.
pool.on('error', () => {});

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function wrap(error) {
  if (errors.isConnectionFailure(error)) return errors.serviceUnavailable();
  if (error instanceof errors.ApiError) return error;
  return error;
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw wrap(error);
  }
}

// A read that must see one single database snapshot.
async function readSnapshot(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw wrap(error);
  }
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (ignored) {
      /* the connection is already gone */
    }
    throw wrap(error);
  } finally {
    client.release();
  }
}

// A write transaction. Every decision about one company's money is serialised
// by locking the company row first, so no two of them interleave.
async function transaction(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw wrap(error);
  }
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (ignored) {
      /* the connection is already gone */
    }
    throw wrap(error);
  } finally {
    client.release();
  }
}

async function lockCompany(client, companyId) {
  await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
}

async function applySchema() {
  await query(SCHEMA_SQL);
}

function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

module.exports = {
  MAX_CONNECTIONS,
  pool,
  newId,
  query,
  readSnapshot,
  transaction,
  lockCompany,
  applySchema,
  poolStats,
};
