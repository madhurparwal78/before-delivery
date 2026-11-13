import type { App } from './app';
import { ApiError } from './errors';
import type { EngagementRow } from './domain';
import type { EngagementState, InvoiceStatus, Milestone } from './types';

/**
 * Invoice status derivation and the overdue rule, decided here alone.
 * An invoice goes overdue strictly after its overdue_at, and only once
 * Kill Bill confirms the brand's OVERDUE blocking state.
 */

export async function refreshOverdue(app: App, engagement: EngagementRow): Promise<void> {
  const statuses = await app.statuses.get(app);
  if (statuses.killbill === 'down') {
    return;
  }
  const invoices = await app.pool.query(
    `SELECT * FROM invoices WHERE engagement_id = $1 AND status = 'payment_failed'`,
    [engagement.id],
  );
  const now = new Date();
  for (const invoice of invoices.rows) {
    if (invoice.overdue_at !== null && new Date(invoice.overdue_at) < now) {
      await goOverdue(app, engagement, invoice);
    }
  }
}

export async function refreshOverdueForInvoice(app: App, engagement: EngagementRow, invoiceId: string): Promise<void> {
  const statuses = await app.statuses.get(app);
  if (statuses.killbill === 'down') {
    return;
  }
  const result = await app.pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND engagement_id = $2 AND status = 'payment_failed'`,
    [invoiceId, engagement.id],
  );
  const now = new Date();
  for (const invoice of result.rows) {
    if (invoice.overdue_at !== null && new Date(invoice.overdue_at) < now) {
      await goOverdue(app, engagement, invoice);
    }
  }
}

async function goOverdue(app: App, engagement: EngagementRow, invoice: Record<string, unknown>): Promise<void> {
  let accountId: string | null = null;
  try {
    accountId = await app.killbill.findAccountByExternalKey(engagement.brand_id);
    if (accountId) {
      await app.killbill.setBlockingState(accountId, 'OVERDUE');
      const states = await app.killbill.getBlockingStates(accountId);
      const overdueConfirmed = states.some(state => state.stateName === 'OVERDUE');
      if (!overdueConfirmed) {
        return;
      }
    } else {
      return;
    }
  } catch {
    return;
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE invoices SET status = 'overdue', overdue_done = TRUE
       WHERE id = $1 AND status = 'payment_failed' RETURNING *`,
      [invoice.id],
    );
    if (updated.rows.length > 0) {
      await queueOutbox(client, {
        kind: 'email',
        payload: {
          type: 'invoice_overdue',
          engagement_id: engagement.id,
          invoice_id: invoice.id,
        },
      });
      await queueOutbox(client, {
        kind: 'push',
        payload: {
          type: 'invoice_overdue',
          engagement_id: engagement.id,
          invoice_id: invoice.id,
        },
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queueOutbox(client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, entry: { kind: string; payload: unknown }): Promise<void> {
  await client.query(
    `INSERT INTO outbox (id, kind, payload) VALUES (gen_random_uuid(), $1, $2)`,
    [entry.kind, JSON.stringify(entry.payload)],
  );
}

export async function hasOtherOverdue(app: App, engagementId: string, excludeInvoiceId: string): Promise<boolean> {
  const result = await app.pool.query(
    `SELECT 1 FROM invoices WHERE engagement_id = $1 AND status = 'overdue' AND id <> $2 LIMIT 1`,
    [engagementId, excludeInvoiceId],
  );
  return result.rows.length > 0;
}

/** Once the brand has no overdue invoice, its blocking state is cleared. */
export async function clearBlockingState(app: App, engagement: EngagementRow): Promise<void> {
  const brandOverdues = await app.pool.query(
    `SELECT COUNT(*) AS count FROM invoices i JOIN engagements e ON e.id = i.engagement_id
     WHERE e.brand_id = $1 AND i.status = 'overdue'`,
    [engagement.brand_id],
  );
  if (Number(brandOverdueCount(brandOverdues.rows)) === 0) {
    try {
      const accountId = await app.killbill.findAccountByExternalKey(engagement.brand_id);
      if (accountId) {
        await app.killbill.setBlockingState(accountId, 'CLEAR');
      }
    } catch {
      // Kill Bill unreachable: clearing can happen on a later request
    }
  }
}

function brandOverdueCount(rows: Record<string, unknown>[]): number {
  return Number(rows[0]?.count ?? 0);
}

export function isPayableStatus(status: InvoiceStatus): boolean {
  return status === 'issued' || status === 'payment_failed' || status === 'overdue';
}
