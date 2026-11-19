// The stream bus keeps no database connection. It wakes when a transaction
// commit lands and notifies each open stream of its own company's rows.
import { query } from './db.js';

const listeners = new Set();

export function subscribe(companyId, lastEventId, fn) {
  const l = { companyId, fn, lastEventId };
  listeners.add(l);
  return () => listeners.delete(l);
}

export function unsubscribe(handle) {
  handle && handle();
}

export function listenerCount() {
  return listeners.size;
}

// Called after a transaction row is committed. The event id is the
// transaction's id, so ids stay durable across restarts.
export function emitTransaction(companyId, transactionRow) {
  for (const l of listeners) {
    if (l.companyId === companyId) {
      try { l.fn(transactionRow); } catch { /* listener gone */ }
    }
  }
}

export function emitBatch(companyId, rows) {
  for (const r of rows) emitTransaction(companyId, r);
}
