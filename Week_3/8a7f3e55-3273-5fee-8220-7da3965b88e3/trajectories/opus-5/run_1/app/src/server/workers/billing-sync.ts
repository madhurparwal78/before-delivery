import { query, queryOne, withTransaction } from '../db/pool.js';
import {
  accountItems,
  createAccount,
  findAccountId,
  postExternalCharge,
} from '../services/killbill.js';

const POLL_INTERVAL_MS = 10_000;

interface PendingLine {
  line_ref: string;
  org_id: string;
  org_name: string;
  booking_ref: string;
  kind: string;
  amount_cents: number;
}

async function claimNext(): Promise<PendingLine | null> {
  return withTransaction(async (client) => {
    const claimed = await client.query<{ line_ref: string }>(
      `UPDATE invoice_lines SET sync_locked_at = now()
       WHERE line_ref = (
         SELECT line_ref FROM invoice_lines
         WHERE sync_status = 'pending_sync'
           AND (sync_locked_at IS NULL OR sync_locked_at < now() - interval '30 seconds')
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING line_ref`,
    );
    const row = claimed.rows[0];
    if (!row) return null;
    const detail = await client.query<PendingLine>(
      `SELECT l.line_ref, l.org_id, o.name AS org_name, b.ref AS booking_ref, l.kind, l.amount_cents
       FROM invoice_lines l JOIN orgs o ON o.id = l.org_id JOIN bookings b ON b.id = l.booking_id
       WHERE l.line_ref = $1`,
      [row.line_ref],
    );
    return detail.rows[0] ?? null;
  });
}

async function accountFor(orgId: string, orgName: string): Promise<string> {
  const cached = await queryOne<{ account_id: string }>(
    'SELECT account_id FROM killbill_accounts WHERE org_id = $1',
    [orgId],
  );
  if (cached) return cached.account_id;
  const existing = await findAccountId(orgId);
  const accountId = existing ?? (await createAccount(orgId, orgName));
  await query(
    'INSERT INTO killbill_accounts (org_id, account_id) VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING',
    [orgId, accountId],
  );
  return accountId;
}

function descriptionFor(line: PendingLine): string {
  const kind = line.kind === 'completed' ? 'completed' : 'late cancellation';
  return `${line.line_ref} ${line.booking_ref} ${kind}`;
}

/**
 * A line counts as synced only once its charge has been read back from Kill Bill; an
 * unclear failure adopts an existing charge with the line's reference instead of posting twice.
 */
async function syncLine(line: PendingLine): Promise<void> {
  const accountId = await accountFor(line.org_id, line.org_name);
  const prefix = `${line.line_ref} `;
  const existing = (await accountItems(accountId)).find((item) =>
    (item.description ?? '').startsWith(prefix),
  );
  if (existing) {
    await query(
      "UPDATE invoice_lines SET sync_status = 'synced', killbill_item_id = $2 WHERE line_ref = $1",
      [line.line_ref, existing.invoiceItemId],
    );
    return;
  }
  await postExternalCharge(accountId, line.amount_cents, descriptionFor(line));
  const posted = (await accountItems(accountId)).find((item) =>
    (item.description ?? '').startsWith(prefix),
  );
  if (!posted) return;
  await query(
    "UPDATE invoice_lines SET sync_status = 'synced', killbill_item_id = $2 WHERE line_ref = $1",
    [line.line_ref, posted.invoiceItemId],
  );
}

async function drainPending(): Promise<void> {
  for (;;) {
    const next = await claimNext();
    if (!next) return;
    try {
      await syncLine(next);
    } catch {
      await query('UPDATE invoice_lines SET sync_locked_at = NULL WHERE line_ref = $1', [
        next.line_ref,
      ]);
      return;
    }
  }
}

export function startBillingSync(): void {
  const tick = (): void => {
    void drainPending().catch(() => undefined);
  };
  setInterval(tick, POLL_INTERVAL_MS).unref();
  tick();
}
