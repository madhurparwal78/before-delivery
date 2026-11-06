import { query, type Queryable } from '../db/pool.js';
import {
  policyInEffect,
  scheduledPolicy,
  splitShares,
  type CoveragePolicyRow,
  type Shares,
} from '../domain/coverage.js';
import { formatMoney, formatPercent } from '../domain/money.js';
import { providerDate } from '../domain/providerTime.js';
import { newId } from '../util/ids.js';

export interface CoverageJson {
  readonly coverage_percent: string;
  readonly scheduled: { coverage_percent: string; effective_on: string } | null;
}

async function policyRows(client: Queryable, organisationId: string): Promise<CoveragePolicyRow[]> {
  const rows = await query<{ coverage_percent_hundredths: number; effective_on: string }>(
    client,
    `SELECT coverage_percent_hundredths, effective_on FROM coverage_policies
     WHERE organisation_id = $1 ORDER BY effective_on, seq`,
    [organisationId],
  );
  return rows.map((row) => ({
    coveragePercentHundredths: row.coverage_percent_hundredths,
    effectiveOn: row.effective_on,
  }));
}

export async function coverageInEffect(
  client: Queryable,
  organisationId: string | null,
  at: Date,
): Promise<number> {
  if (organisationId === null) return 0;
  const policy = policyInEffect(await policyRows(client, organisationId), providerDate(at));
  return policy?.coveragePercentHundredths ?? 0;
}

export async function coverageJson(
  client: Queryable,
  organisationId: string,
  at: Date,
): Promise<CoverageJson> {
  const today = providerDate(at);
  const rows = await policyRows(client, organisationId);
  const inEffect = policyInEffect(rows, today);
  const scheduled = scheduledPolicy(rows, today);
  return {
    coverage_percent: formatPercent(inEffect?.coveragePercentHundredths ?? 0),
    scheduled:
      scheduled === null
        ? null
        : {
            coverage_percent: formatPercent(scheduled.coveragePercentHundredths),
            effective_on: scheduled.effectiveOn,
          },
  };
}

/** A later-dated change replaces any earlier scheduled one; a change for today is kept alongside. */
export async function saveCoverage(
  client: Queryable,
  organisationId: string,
  coveragePercentHundredths: number,
  effectiveOn: string,
  at: Date,
): Promise<void> {
  const today = providerDate(at);
  if (effectiveOn > today) {
    await client.query(
      'DELETE FROM coverage_policies WHERE organisation_id = $1 AND effective_on > $2',
      [organisationId, today],
    );
  }
  await client.query(
    `INSERT INTO coverage_policies (id, organisation_id, coverage_percent_hundredths, effective_on)
     VALUES ($1, $2, $3, $4)`,
    [newId(), organisationId, coveragePercentHundredths, effectiveOn],
  );
}

export interface QuoteJson {
  readonly list_price: string;
  readonly employer_share: string;
  readonly learner_share: string;
  readonly coverage_percent: string;
  readonly sponsor: string | null;
}

export function quoteJson(shares: Shares, sponsorName: string | null): QuoteJson {
  return {
    list_price: formatMoney(shares.listPriceCents),
    employer_share: formatMoney(shares.employerShareCents),
    learner_share: formatMoney(shares.learnerShareCents),
    coverage_percent: formatPercent(shares.coveragePercentHundredths),
    sponsor: sponsorName,
  };
}

/** The quote is always computed under the policy in effect at the instant of the request. */
export async function quoteForLearner(
  client: Queryable,
  learnerOrganisationId: string | null,
  learnerOrganisationName: string | null,
  listPriceCents: number,
  at: Date,
): Promise<{ shares: Shares; json: QuoteJson }> {
  const percent = await coverageInEffect(client, learnerOrganisationId, at);
  const shares = splitShares(listPriceCents, percent);
  return { shares, json: quoteJson(shares, learnerOrganisationName) };
}
