import { pool, withClient } from './db.js';
import { runChartJob } from './chart.js';
import { storeUnstored } from './tickets.js';
import { smtpSend } from './mail.js';
import { refundByKey, ensureAccount, KillBillUnreachable } from './killbill.js';
import { loadBooking } from './cancel.js';
import { paiseToRupees, formatPaise } from '../money.js';

// Background workers: the chart job, the outbox sender, the pending-refund
// retry and the unstored-ticket retry.

export async function startWorkers(): Promise<void> {
  void chartLoop();
  void mailLoop();
  void refundLoop();
  void ticketLoop();
}

async function every(ms: number, fn: () => Promise<void>): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, ms));
    try {
      await fn();
    } catch {
      // a worker never stops
    }
  }
}

async function chartLoop(): Promise<void> {
  await every(2000, async () => {
    await withClient(async (c) => {
      await runChartJob(c);
    });
  });
}

async function mailLoop(): Promise<void> {
  await every(4000, async () => {
    const rows = (
      await pool.query<{ id: string; to_email: string; subject: string; body: string }>(
        'SELECT id, to_email, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 20',
      )
    ).rows;
    for (const m of rows) {
      const ok = await smtpSend(m.to_email, m.subject, m.body);
      if (ok) await pool.query('UPDATE mail_outbox SET sent_at = now() WHERE id = $1', [m.id]);
    }
  });
}

async function refundLoop(): Promise<void> {
  await every(10_000, async () => {
    const rows = (
      await pool.query<{ pnr: string; number: number; refund_paise: string }>(
        `SELECT pnr, number, refund_paise FROM refunds WHERE status = 'pending' ORDER BY pnr, number LIMIT 20`,
      )
    ).rows;
    for (const r of rows) {
      const owner = (
        await pool.query<{ id: string; name: string }>(
          'SELECT a.id, a.name FROM accounts a JOIN bookings bb ON bb.account_id = a.id WHERE bb.pnr = $1', [r.pnr],
        )
      ).rows[0];
      if (!owner) continue;
      try {
        const kbAccount = await ensureAccount(owner.id, owner.name);
        const ok = await refundByKey(kbAccount, r.pnr, `${r.pnr}-refund-${r.number}`, paiseToRupees(Number(r.refund_paise)));
        if (ok) {
          await withClient(async (c) => {
            await c.query(
              `UPDATE refunds SET status = 'issued', issued_at = now() WHERE pnr = $1 AND number = $2`,
              [r.pnr, r.number],
            );
            await c.query('UPDATE bookings SET version = version + 1 WHERE pnr = $1', [r.pnr]);
            const email = (
              await c.query<{ email: string }>('SELECT a.email FROM accounts a WHERE a.id = $1', [owner.id])
            ).rows[0]?.email;
            if (email) {
              await c.query('INSERT INTO mail_outbox (to_email, subject, body) VALUES ($1,$2,$3)',
                [email, `Refund issued: PNR ${r.pnr}`, `${formatPaise(Number(r.refund_paise))}\n`]);
            }
          });
        }
      } catch (e) {
        if (e instanceof KillBillUnreachable) continue;
        throw e;
      }
    }
  });
}

async function ticketLoop(): Promise<void> {
  await every(8000, async () => {
    const rows = (
      await pool.query<{ pnr: string }>(
        'SELECT DISTINCT pnr FROM tickets WHERE stored = false LIMIT 20',
      )
    ).rows;
    for (const r of rows) {
      const c = await pool.connect();
      try {
        const b = await loadBooking(c, r.pnr);
        if (b) await storeUnstored(c, b);
      } finally {
        c.release();
      }
    }
  });
}
