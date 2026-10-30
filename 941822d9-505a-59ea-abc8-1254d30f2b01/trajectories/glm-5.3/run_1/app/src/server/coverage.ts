import { employerShareCents } from "./money.ts";
import { providerStartOfDate } from "./time.ts";

// The coverage policy in effect at an instant and the share split live here and
// nowhere else.

/** Anything that can run a parameterised query, plain or in a transaction. */
export type QuerierLike = {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type PolicyInEffect = { percentH: number; hospitalId: string };

export async function policyInEffect(querier: QuerierLike, hospitalId: string): Promise<PolicyInEffect> {
  await promoteScheduledIfDue(querier, hospitalId);
  const { rows } = await querier.query(
    `SELECT coverage_percent::text AS pct FROM coverage_policies
      WHERE hospital_id = $1 AND effective_from <= now()
      ORDER BY effective_from DESC LIMIT 1`,
    [hospitalId],
  );
  const row = rows[0] as { pct: string } | undefined;
  return { percentH: row ? Math.round(Number(row.pct) * 100) : 0, hospitalId };
}

export type ScheduledChange = { percentH: number; effectiveOn: string } | null;

export async function scheduledChange(querier: QuerierLike, hospitalId: string): Promise<ScheduledChange> {
  const { rows } = await querier.query(
    `SELECT coverage_percent::text AS coverage_percent, to_char(effective_on,'YYYY-MM-DD') AS effective_on
       FROM coverage_scheduled WHERE hospital_id = $1`,
    [hospitalId],
  );
  const row = rows[0] as { coverage_percent: string; effective_on: string } | undefined;
  return row ? { percentH: Math.round(Number(row.coverage_percent) * 100), effectiveOn: row.effective_on } : null;
}

async function promoteScheduledIfDue(querier: QuerierLike, hospitalId: string): Promise<void> {
  const { rows } = await querier.query(
    `SELECT coverage_percent::text AS coverage_percent, to_char(effective_on,'YYYY-MM-DD') AS effective_on
       FROM coverage_scheduled WHERE hospital_id = $1`,
    [hospitalId],
  );
  const row = rows[0] as { coverage_percent: string; effective_on: string } | undefined;
  if (!row) return;
  const due = providerStartOfDate(row.effective_on);
  if (Date.now() >= due.getTime()) {
    await querier.query(
      `INSERT INTO coverage_policies (id, hospital_id, coverage_percent, effective_from, effective_on)
       VALUES (gen_random_uuid(), $1, $2, now(), $3)`,
      [hospitalId, row.coverage_percent, row.effective_on],
    );
    await querier.query(`DELETE FROM coverage_scheduled WHERE hospital_id = $1`, [hospitalId]);
  }
}

export type Split = { employerCents: number; learnerCents: number; percentH: number };

export const splitShares = (listPriceCents: number, percentH: number): Split => {
  const employerCents = employerShareCents(listPriceCents, percentH);
  return { employerCents, learnerCents: listPriceCents - employerCents, percentH };
};
