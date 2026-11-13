import { query, withTransaction } from './db.js';
import { moveBox } from './orders.js';
import { publishBox } from './shelfHub.js';
import { reindexBox } from './indexer.js';
import { alert } from './fulfilment.js';
import { stockAfterChange, checkCrossings } from './stock.js';
import { sendMail } from './mail.js';
import { formatOre } from '../shared/money.js';
import * as gw from './gateway.js';

/** Server-side expiry sweeps. Runs with nobody watching. */

/** Boxes marked held whose Valkey key has gone have ended on their own. */
export async function sweepStaleHolds(): Promise<void> {
  const rows = await query<{ number: number }>("SELECT number FROM boxes WHERE box_state = 'held'");
  for (const row of rows) {
    const { holdExists } = await import('./holds.js');
    if (!(await holdExists(row.number))) {
      await withTransaction(async (client) => {
        const upd = await client.query(
          "UPDATE boxes SET box_state = 'available' WHERE number = $1 AND box_state = 'held'",
          [row.number],
        );
        return upd.rowCount === 1;
      }).catch(() => false);
      const { publishBox } = await import('./shelfHub.js');
      publishBox(row.number, 'available');
    }
  }
}

export async function sweepTransfers(): Promise<void> {
  // Pending orders past their deadline lapse, the box returns to sale and the
  // buyer is notified.
  const rows = await query<{ reference: string; number: number; buyer_email: string; transfer_deadline_at: Date; gateway_transfer_id: string | null }>(
    "SELECT reference, number, buyer_email, transfer_deadline_at, gateway_transfer_id FROM orders WHERE payment_state = 'pending' AND transfer_deadline_at < now()",
  );
  for (const row of rows) {
    const ok = await withTransaction(async (client) => {
      const upd = await client.query(
        "UPDATE orders SET payment_state = 'lapsed' WHERE reference = $1 AND payment_state = 'pending'",
        [row.reference],
      );
      if (upd.rowCount !== 1) return false;
      await moveBox(client, row.number, 'awaiting_transfer', 'available', row.reference);
      return true;
    }).catch(() => false);
    if (!ok) continue;
    publishBox(row.number, 'available');
    await stockAfterChange('awaiting_transfer', 'available', row.number);
    void reindexBox(row.number, 'goose', 'available').catch(() => {});
    try {
      await sendMail(row.buyer_email, `Your transfer deadline passed: box ${row.number} (${row.reference})`,
        `Your transfer deadline passed. Box ${row.number} is back on the shelf.`);
    } catch { /* retried under its own policy */ }
  }
}

export async function sweepAuthorisations(): Promise<void> {
  // Uncaptured authorisations void at their edge.
  const rows = await query<{ reference: string; number: number; buyer_email: string; gateway_payment_id: string | null; kb_payment_id: string | null; total_ore: number }>(
    "SELECT reference, number, buyer_email, gateway_payment_id, kb_payment_id, total_ore FROM orders WHERE payment_state = 'authorised' AND auth_expires_at < now()",
  );
  for (const row of rows) {
    const ok = await withTransaction(async (client) => {
      const upd = await client.query(
        "UPDATE orders SET payment_state = 'authorisation_expired' WHERE reference = $1 AND payment_state = 'authorised'",
        [row.reference],
      );
      if (upd.rowCount !== 1) return false;
      await moveBox(client, row.number, 'claimed', 'available', row.reference);
      return true;
    }).catch(() => false);
    if (!ok) continue;
    if (row.gateway_payment_id) {
      await gw.voidPayment(row.gateway_payment_id, `void-exp-${row.reference}`).catch(() => {});
    }
    publishBox(row.number, 'available');
    await stockAfterChange('claimed', 'available', row.number);
    void reindexBox(row.number, 'goose', 'available').catch(() => {});
    await alert('Authorisation expired', `Box ${row.number}: authorisation of DKK ${formatOre(row.total_ore)} expired and was voided.`);
  }
}

export async function sweepChallenges(): Promise<void> {
  // Challenges that outlived their window end on their own.
  const rows = await query<{ challenge_id: string; reference: string }>(
    "UPDATE orders SET payment_state = 'declined', challenge_id = NULL, challenge_expires_at = NULL WHERE challenge_expires_at < now() AND payment_state = 'challenge' RETURNING challenge_id, reference",
  );
  void rows;
}

export function start(): void {
  setInterval(() => {
    sweepStaleHolds().catch(() => {});
    sweepTransfers().catch(() => {});
    sweepAuthorisations().catch(() => {});
    sweepChallenges().catch(() => {});
    checkCrossings().catch(() => {});
    import('./bus.js').then((bus) => bus.flushDelayedRetries()).catch(() => {});
  }, 2000);
}
