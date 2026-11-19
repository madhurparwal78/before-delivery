'use strict';

// The live transaction stream. Every open stream shares one poll of the
// database, so the number of streams never raises the number of connections.

const db = require('./db');
const clock = require('./clock');
const domain = require('./domain');

const TICK_MS = 700;
const BATCH = 500;
const HEARTBEAT_MS = 15000;

const streams = new Set();
let timer = null;
let poking = false;

function positionAfter(a, b) {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs > b.createdAtMs;
  return a.id > b.id;
}

function write(stream, chunk) {
  try {
    stream.res.write(chunk);
  } catch (error) {
    close(stream);
  }
}

function sendTransaction(stream, row) {
  const payload = JSON.stringify(domain.serializeTransaction(row));
  write(stream, `id: ${row.id}\nevent: transaction\ndata: ${payload}\n\n`);
}

function close(stream) {
  if (streams.delete(stream)) {
    clearInterval(stream.heartbeat);
    try {
      stream.res.end();
    } catch (error) {
      /* the client is already gone */
    }
  }
  if (streams.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function resolveCursor(companyId, lastEventId) {
  if (lastEventId && /^[0-9a-f]{32}$/.test(lastEventId)) {
    const found = await db.query(
      'SELECT created_at, id FROM transactions WHERE id = $1 AND company_id = $2',
      [lastEventId, companyId]
    );
    if (found.rows.length > 0) {
      return { createdAtMs: new Date(found.rows[0].created_at).getTime(), id: found.rows[0].id };
    }
  }
  return { createdAtMs: clock.nowMs(), id: '' };
}

async function tick() {
  if (streams.size === 0) return;
  const open = [...streams];

  const tokenHashes = [...new Set(open.map((stream) => stream.tokenHash))];
  const live = await db.query(
    'SELECT token_hash FROM sessions WHERE token_hash = ANY($1) AND revoked_at IS NULL',
    [tokenHashes]
  );
  const liveTokens = new Set(live.rows.map((row) => row.token_hash));
  for (const stream of open) {
    if (!liveTokens.has(stream.tokenHash)) close(stream);
  }
  if (streams.size === 0) return;

  const remaining = [...streams];
  let min = remaining[0].cursor;
  for (const stream of remaining) {
    if (positionAfter(min, stream.cursor)) min = stream.cursor;
  }

  const rows = await db.query(
    `SELECT id, company_id, account_id, direction, amount_cents, method, counterparty, memo,
            transfer_id, created_at
       FROM transactions
      WHERE (created_at, id) > ($1, $2)
      ORDER BY created_at, id
      LIMIT ${BATCH}`,
    [new Date(min.createdAtMs), min.id]
  );
  if (rows.rows.length === 0) return;

  for (const stream of remaining) {
    for (const row of rows.rows) {
      const position = { createdAtMs: new Date(row.created_at).getTime(), id: row.id };
      if (!positionAfter(position, stream.cursor)) continue;
      if (row.company_id === stream.companyId) sendTransaction(stream, row);
      stream.cursor = position;
    }
  }
}

function startTimer() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(() => {});
  }, TICK_MS);
  timer.unref();
}

// A hint that a transaction has just been written, so delivery does not wait
// for the next tick.
function poke() {
  if (streams.size === 0 || poking) return;
  poking = true;
  setTimeout(() => {
    poking = false;
    tick().catch(() => {});
  }, 60).unref();
}

async function open(res, { companyId, tokenHash, lastEventId }) {
  const cursor = await resolveCursor(companyId, lastEventId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');
  const stream = { res, companyId, tokenHash, cursor, heartbeat: null };
  stream.heartbeat = setInterval(() => write(stream, ': ping\n\n'), HEARTBEAT_MS);
  stream.heartbeat.unref();
  streams.add(stream);
  startTimer();
  res.on('close', () => close(stream));
  res.on('error', () => close(stream));
  poke();
}

// Signing out closes that session's open streams at once.
function closeForToken(tokenHash) {
  for (const stream of [...streams]) {
    if (stream.tokenHash === tokenHash) close(stream);
  }
}

function count() {
  return streams.size;
}

module.exports = { open, closeForToken, poke, count };
