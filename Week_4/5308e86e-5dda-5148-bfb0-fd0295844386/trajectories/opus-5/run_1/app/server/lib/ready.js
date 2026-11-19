'use strict';

// Tallwind starts even while its database is unreachable: it keeps listening,
// answers health with its 503 body, and applies its schema and seed the moment
// the database first answers.

const db = require('./db');
const seed = require('./seed');

let bootstrapped = false;
let running = null;
let firstHealthyAt = null;
const listeners = [];

async function bootstrap() {
  await db.applySchema();
  await seed.seedIfEmpty();
  bootstrapped = true;
}

function ensureBootstrapped() {
  if (bootstrapped) return Promise.resolve(true);
  if (!running) {
    running = bootstrap()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        running = null;
      });
  }
  return running;
}

// Health answers 200 only while the database is reachable and the schema, the
// audit protection and the seed are all in place.
async function isHealthy() {
  if (!bootstrapped) {
    const ok = await ensureBootstrapped();
    if (!ok) return false;
  }
  try {
    const result = await db.query(
      `SELECT (SELECT value FROM app_state WHERE key = 'seeded') AS seeded,
              (SELECT count(*) FROM pg_trigger WHERE tgname = 'audit_events_append_only_row') AS guard`
    );
    const row = result.rows[0];
    const healthy = Boolean(row && row.seeded) && Number(row.guard) > 0;
    if (healthy && firstHealthyAt === null) {
      firstHealthyAt = Date.now();
      for (const listener of listeners) listener();
    }
    return healthy;
  } catch (error) {
    return false;
  }
}

function onFirstHealthy(listener) {
  if (firstHealthyAt !== null) listener();
  else listeners.push(listener);
}

// Every endpoint that needs the database refuses with 503 while it is unreachable.
async function requireDatabase() {
  if (bootstrapped) return;
  const ok = await ensureBootstrapped();
  if (!ok) {
    const errors = require('./errors');
    throw errors.serviceUnavailable();
  }
}

function startRetryLoop() {
  const tick = () => {
    isHealthy().catch(() => {});
  };
  tick();
  const timer = setInterval(tick, 2000);
  timer.unref();
}

module.exports = { ensureBootstrapped, isHealthy, requireDatabase, onFirstHealthy, startRetryLoop };
