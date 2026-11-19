import { query, withTransaction, isUnreachable } from './db.js';
import { now } from './clock.js';
import { nyParts, nyMidnightUtcMs, dateStr, dateFromStr, addCalendarDays } from './calendar.js';
import { effectiveDateForPost } from './domain.js';
import { writeAudit, applyDebit, transactionOut } from './store.js';
import { ApiError } from './http.js';
import { emitTransaction } from './stream-bus.js';
import { ready } from './bootstrap.js';

const SYSTEM_ACTOR = 'system@tallwind.invalid';

let timer = null;
let running = false;

// Every 15 seconds: post due scheduled payments and expire due held
// payments. Both work with transaction-scoped locking so two copies of serve
// never process one payment twice.
export function startScheduler() {
  if (timer) return;
  timer = setInterval(runDue, 15000);
  timer.unref();
  setTimeout(runDue, 3000).unref();
}

export async function runDue() {
  if (running) return;
  running = true;
  try {
    await postDueScheduled();
    await expireDuePayments();
  } catch {
    // Unreachable or busy; the next tick retries.
  } finally {
    running = false;
  }
}

async function postDueScheduled() {
  const at = now();
  const due = await query(
    "SELECT p.*, c.id AS company_id FROM payments p JOIN companies c ON c.id = p.company_id WHERE p.status = 'scheduled' AND p.effective_date IS NOT NULL AND p.effective_date < $1 ORDER BY p.effective_date ASC, p.created_at ASC, p.id ASC LIMIT 200",
    [new Date(at)]
  );
  for (const p of due.rows) {
    await postOne(p);
  }
}

async function postOne(p) {
  const at = now();
  const emitted = [];
  try {
    await withTransaction(async (client) => {
      const res = await client.query(
        "SELECT * FROM payments WHERE id = $1 AND status = 'scheduled' FOR UPDATE",
        [p.id]
      );
      if (res.rowCount === 0) return;
      const payment = res.rows[0];
      const account = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [payment.source_account_id]);
      if (account.rowCount === 0) return;
      const heldRes = await client.query(
        "SELECT COALESCE(SUM(total_debit_cents), 0) AS h FROM payments WHERE source_account_id = $1 AND status = 'pending_approval'",
        [payment.source_account_id]
      );
      const available = Number(account.rows[0].balance_cents) - Number(heldRes.rows[0].h);
      if (available < Number(payment.total_debit_cents)) {
        await client.query("UPDATE payments SET status = 'failed' WHERE id = $1", [payment.id]);
        await writeAudit(client, payment.company_id, 'payment.failed', payment.id, Number(payment.amount_cents), SYSTEM_ACTOR, at);
        return;
      }
      // A scheduled payment keeps the effective date stored at scheduling.
      const txId = `txn_${payment.id.slice(5)}`;
      await applyDebit(client, payment.source_account_id, Number(payment.total_debit_cents), payment.recipient_name, payment.method, payment.memo, null, at, txId);
      await client.query("UPDATE payments SET status = 'posted' WHERE id = $1", [payment.id]);
      await writeAudit(client, payment.company_id, 'payment.posted', payment.id, Number(payment.total_debit_cents), SYSTEM_ACTOR, at);
      emitted.push({ companyId: payment.company_id, txId });
    });
  } catch {
    // Another worker or a restart race; the next pass retries.
  }
  for (const e of emitted) {
    const row = await query('SELECT * FROM transactions WHERE id = $1', [e.txId]);
    if (row.rowCount > 0) emitTransaction(e.companyId, transactionOut(row.rows[0]));
  }
}

async function expireDuePayments() {
  const at = now();
  const due = await query(
    "SELECT * FROM payments WHERE status = 'pending_approval' AND expires_at IS NOT NULL AND expires_at <= $1 ORDER BY expires_at ASC, created_at ASC, id ASC LIMIT 200",
    [new Date(at)]
  );
  for (const p of due.rows) {
    try {
      await withTransaction(async (client) => {
        const res = await client.query(
          "SELECT * FROM payments WHERE id = $1 AND status = 'pending_approval' FOR UPDATE",
          [p.id]
        );
        if (res.rowCount === 0) return;
        if (new Date(res.rows[0].expires_at).getTime() > at) return;
        await client.query("UPDATE payments SET status = 'expired' WHERE id = $1", [p.id]);
        await writeAudit(client, res.rows[0].company_id, 'payment.expired', p.id, Number(p.amount_cents), SYSTEM_ACTOR, at);
      });
    } catch {
      // The next pass retries.
    }
  }
}
