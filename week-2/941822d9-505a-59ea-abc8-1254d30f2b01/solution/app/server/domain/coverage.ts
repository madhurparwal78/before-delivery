import { one, type Db } from "../db.js";
import { formatMoney, formatPercent, splitShares } from "./amounts.js";
import { provider, providerToday } from "./provider.js";
import { providerMidnight } from "./time.js";
import type { SessionUser } from "./users.js";
import { hospitalOf } from "./users.js";

// Coverage policy: one percent in effect at any instant, at most one scheduled change.

interface PolicyRow {
  percent_bp: number;
  effective_on: string;
}

/** The coverage percent (basis points) in effect for a hospital at an instant. */
async function coverageInEffect(t: Db, hospitalId: string, at: Date): Promise<number> {
  const row = await one<PolicyRow>(
    t,
    `SELECT percent_bp, effective_on FROM coverage_policies
      WHERE hospital_id = $1 AND superseded_at IS NULL AND effective_at <= $2
      ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [hospitalId, at],
  );
  return row?.percent_bp ?? 0;
}

export async function coverageJson(t: Db, hospitalId: string, at: Date): Promise<Record<string, unknown>> {
  const scheduled = await one<PolicyRow>(
    t,
    `SELECT percent_bp, effective_on FROM coverage_policies
      WHERE hospital_id = $1 AND superseded_at IS NULL AND effective_at > $2
      ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [hospitalId, at],
  );
  return {
    coverage_percent: formatPercent(await coverageInEffect(t, hospitalId, at)),
    scheduled: scheduled ? { coverage_percent: formatPercent(scheduled.percent_bp), effective_on: scheduled.effective_on } : null,
  };
}

/**
 * Records a coverage change. Effective today: in effect from this instant, any scheduled change stays.
 * A later date: becomes the scheduled change (replacing any earlier one) and takes effect at 00:00 provider time.
 */
export async function scheduleCoverage(t: Db, hospitalId: string, basisPoints: number, effectiveOn: string, now: Date): Promise<void> {
  const today = effectiveOn === providerToday(now);
  if (!today) {
    await t.q("UPDATE coverage_policies SET superseded_at = $2 WHERE hospital_id = $1 AND superseded_at IS NULL AND effective_at > $2", [hospitalId, now]);
  }
  await t.q(
    `INSERT INTO coverage_policies (hospital_id, percent_bp, effective_on, effective_at, recorded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hospitalId, basisPoints, effectiveOn, today ? now : providerMidnight(provider.timeZone, effectiveOn), now],
  );
}

export interface Quote {
  listPriceCents: number;
  employerCents: number;
  learnerCents: number;
  coverageBasisPoints: number;
  sponsor: { id: string; name: string } | null;
  /** Card when the employer share is 0.00, co-pay otherwise. */
  funding: "card" | "co_pay";
}

/** The quote for a nurse under the coverage policy in effect at `at`. */
export async function quoteFor(t: Db, nurse: SessionUser, listPriceCents: number, at: Date): Promise<Quote> {
  const hospital = hospitalOf(nurse);
  const coverageBasisPoints = hospital ? await coverageInEffect(t, hospital.id, at) : 0;
  const split = splitShares(listPriceCents, coverageBasisPoints);
  return {
    listPriceCents,
    ...split,
    coverageBasisPoints,
    sponsor: hospital ? { id: hospital.id, name: hospital.name } : null,
    funding: split.employerCents === 0 ? "card" : "co_pay",
  };
}

export const quoteJson = (quote: Quote): Record<string, unknown> => ({
  list_price: formatMoney(quote.listPriceCents),
  employer_share: formatMoney(quote.employerCents),
  learner_share: formatMoney(quote.learnerCents),
  coverage_percent: formatPercent(quote.coverageBasisPoints),
  sponsor: quote.sponsor?.name ?? null,
});
