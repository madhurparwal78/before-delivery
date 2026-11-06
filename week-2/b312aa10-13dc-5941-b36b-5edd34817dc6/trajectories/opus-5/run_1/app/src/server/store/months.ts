import type { Queryable } from '../db/pool.js';

/** The figures stored at close, kept byte for byte. */
export type FrozenMonth = {
  closedAtMs: number;
  report: string;
  csv: string;
  closeNames: Record<string, string>;
};

export async function isMonthClosed(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<boolean> {
  const result = await client.query<{ month: string }>(
    `select month from closed_months where kitchen_id = $1 and month = $2`,
    [kitchenId, month],
  );
  return result.rows.length > 0;
}

export async function closedMonths(client: Queryable, kitchenId: string): Promise<string[]> {
  const result = await client.query<{ month: string }>(
    `select month from closed_months where kitchen_id = $1 order by month`,
    [kitchenId],
  );
  return result.rows.map((row) => row.month);
}

export async function frozenMonth(
  client: Queryable,
  kitchenId: string,
  month: string,
): Promise<FrozenMonth | null> {
  const result = await client.query<{
    closed_at: Date;
    report: string;
    csv: string;
    close_names: Record<string, string>;
  }>(
    `select closed_at, report, csv, close_names from closed_months
      where kitchen_id = $1 and month = $2`,
    [kitchenId, month],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    closedAtMs: row.closed_at.getTime(),
    report: row.report,
    csv: row.csv,
    closeNames: row.close_names,
  };
}

export async function frozenInvoice(
  client: Queryable,
  kitchenId: string,
  month: string,
  memberId: string,
): Promise<string | null> {
  const result = await client.query<{ body: string }>(
    `select body from closed_month_invoices
      where kitchen_id = $1 and month = $2 and member_id = $3`,
    [kitchenId, month, memberId],
  );
  return result.rows[0]?.body ?? null;
}

export async function closeMonth(
  client: Queryable,
  kitchenId: string,
  month: string,
  closedAtMs: number,
  report: unknown,
  csv: string,
  closeNames: Record<string, string>,
  invoices: Array<{ memberId: string; body: unknown }>,
): Promise<void> {
  await client.query(
    `insert into closed_months (kitchen_id, month, closed_at, report, csv, close_names)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      kitchenId,
      month,
      new Date(closedAtMs).toISOString(),
      JSON.stringify(report),
      csv,
      JSON.stringify(closeNames),
    ],
  );
  for (const invoice of invoices) {
    await client.query(
      `insert into closed_month_invoices (kitchen_id, month, member_id, body)
       values ($1,$2,$3,$4)`,
      [kitchenId, month, invoice.memberId, JSON.stringify(invoice.body)],
    );
  }
}

/** The earliest open kitchen-local month at or after the current month. */
export async function earliestOpenMonth(
  client: Queryable,
  kitchenId: string,
  currentMonth: string,
  nextMonth: (month: string) => string,
): Promise<string> {
  const closed = new Set(await closedMonths(client, kitchenId));
  let candidate = currentMonth;
  while (closed.has(candidate)) {
    candidate = nextMonth(candidate);
  }
  return candidate;
}
