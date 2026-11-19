import { query } from './db.js';
import { findSessionByToken, transactionOut } from './store.js';
import { subscribe } from './stream-bus.js';
import { isoAt } from './clock.js';
import { isWellFormedId } from './ids.js';

// A stream never holds a database connection. It polls for its company's
// newer transactions on a shared timer and answers 401 when the session is
// gone, letting the server close it within two seconds of a logout.
const POLL_MS = 700;

export async function handleStream(req, res, url) {
  const token = url.searchParams.get('token') || '';
  let sess = null;
  try {
    sess = await findSessionByToken(token);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (!sess) {
    res.writeHead(401, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const lastEventIdHeader = String(req.headers['last-event-id'] || '');
  const queryLastEventId = url.searchParams.get('last_event_id') || '';
  let lastEventId = queryLastEventId || lastEventIdHeader;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  let closed = false;
  const sendEvent = (tx) => {
    if (closed) return;
    try {
      res.write(`id: ${tx.id}\nevent: transaction\ndata: ${JSON.stringify(tx)}\n\n`);
    } catch {
      close();
    }
  };

  let lastPollAt = 0;
  const poll = async () => {
    if (closed) return;
    let rows = [];
    try {
      const cutoffId = isWellFormedId(lastEventId) ? lastEventId : null;
      if (cutoffId) {
        // Replay every company transaction after the named event, oldest first.
        const anchor = await query('SELECT created_at FROM transactions WHERE id = $1', [cutoffId]);
        if (anchor.rowCount > 0) {
          const after = await query(
            `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
             WHERE a.company_id = $1 AND (t.created_at, t.id) > ($2, $3)
             ORDER BY t.created_at ASC, t.id ASC LIMIT 500`,
            [sess.company_id, anchor.rows[0].created_at, cutoffId]
          );
          rows = after.rows;
        }
      } else {
        const latest = await query(
          `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
           WHERE a.company_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT 1`,
          [sess.company_id]
        );
        if (latest.rowCount > 0) rows = [latest.rows[0]];
      }
    } catch {
      // The database is briefly unreachable; keep the stream open and retry.
    }
    for (const row of rows) {
      const out = transactionOut(row);
      sendEvent(out);
      lastEventId = out.id;
    }
    lastPollAt = Date.now();
  };

  // Live updates come from the bus; replays and catch-up come from polling.
  const busHandle = subscribe(sess.company_id, (tx) => {
    if (closed) return;
    sendEvent(tx);
    lastEventId = tx.id;
  });

  const interval = setInterval(async () => {
    if (closed) return;
    // Confirm the session still exists; a logout closes this within 2s.
    try {
      const alive = await query('SELECT 1 FROM sessions WHERE token = $1', [token]);
      if (alive.rowCount === 0) {
        close();
        return;
      }
    } catch {
      // Keep trying; an outage must not end the stream.
    }
    await poll();
  }, POLL_MS);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    busHandle();
    try { res.end(); } catch { /* already gone */ }
  }

  req.on('close', close);
  res.on('close', close);

  await poll();
}
