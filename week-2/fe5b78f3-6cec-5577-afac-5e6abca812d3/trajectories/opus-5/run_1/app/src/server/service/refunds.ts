import { formatMoney } from '../domain/money';
import type { AppServices } from '../http/context';
import { queueMail } from './outbox';

interface PendingRefund {
  readonly pnr: string;
  readonly number: number;
  readonly refund_paise: number;
  readonly killbill_payment_id: string | null;
  readonly email: string;
}

async function loadPending(app: AppServices, pnr: string | null): Promise<PendingRefund[]> {
  const where = pnr === null ? '' : 'and r.pnr = $1';
  return app.database.query<PendingRefund>(
    `select r.pnr, r.number, r.refund_paise, b.killbill_payment_id, a.email
     from refunds r
     join bookings b on b.pnr = r.pnr
     join accounts a on a.id = b.account_id
     where r.status = 'pending' ${where}
     order by r.pnr, r.number`,
    pnr === null ? [] : [pnr],
  );
}

/**
 * A refund becomes issued only once Kill Bill reports its REFUND transaction as SUCCESS, and only
 * one instance ever marks it.
 */
async function issue(app: AppServices, refund: PendingRefund): Promise<void> {
  if (refund.killbill_payment_id === null) return;
  const recorded = await app.killbill.refund(
    refund.killbill_payment_id,
    `${refund.pnr}-refund-${refund.number}`,
    refund.refund_paise,
  );
  if (!recorded) return;
  await app.database.transaction(async (tx) => {
    const claimed = await tx.query<{ number: number }>(
      `update refunds set status = 'issued', issued_at = now()
       where pnr = $1 and number = $2 and status = 'pending'
       returning number`,
      [refund.pnr, refund.number],
    );
    if (claimed.length === 0) return;
    await tx.query('update bookings set version = version + 1 where pnr = $1', [refund.pnr]);
    await queueMail(tx, {
      dedupeKey: `refund:${refund.pnr}:${refund.number}`,
      to: refund.email,
      subject: `Refund issued: PNR ${refund.pnr}`,
      body: `Refund of ${formatMoney(refund.refund_paise)} for PNR ${refund.pnr} has been issued.`,
    });
  });
}

export async function tryIssueRefund(
  app: AppServices,
  pnr: string,
  number: number,
): Promise<void> {
  const pending = await loadPending(app, pnr);
  const refund = pending.find((entry) => entry.number === number);
  if (refund !== undefined) await issue(app, refund);
}

/** Retried while Kill Bill is unreachable. */
export async function issuePendingRefunds(app: AppServices): Promise<void> {
  for (const refund of await loadPending(app, null)) {
    await issue(app, refund).catch(() => undefined);
  }
}
