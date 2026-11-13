import { config } from "../config";
import type { Row } from "../db/pool";
import type { PayBand, PayRow, Rating } from "../../shared/api";
import { CITIES, ROLE_FAMILIES, type CityId, type RoleFamilyId } from "../../shared/reference";

export interface Queryable {
  query<T extends Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

type PayReports = { role_family: RoleFamilyId; city: CityId; amounts: number[] };
type CompanyFigures = { rating: Rating; payReports: PayReports[] };

/** Mean of 1 to 5 scores, rounded half up to one decimal on the exact mean. */
function meanOneDecimal(sum: number, count: number): number | null {
  if (count === 0) return null;
  return Math.floor((20 * sum + count) / (2 * count)) / 10;
}

/** The nth quarter percentile (1 = low, 2 = median, 3 = high), interpolated linearly between closest ranks, rounded half up. */
function quarterPercentile(sorted: number[], quarter: 1 | 2 | 3): number {
  const position = (sorted.length - 1) * quarter;
  const lower = Math.floor(position / 4);
  const remainder = position - lower * 4;
  const below = sorted[lower] ?? 0;
  const above = sorted[Math.min(lower + 1, sorted.length - 1)] ?? below;
  return Math.floor((4 * below + (above - below) * remainder + 2) / 4);
}

function bandOf(amounts: number[]): PayBand {
  const sorted = [...amounts].sort((a, b) => a - b);
  return { low: quarterPercentile(sorted, 1), median: quarterPercentile(sorted, 2), high: quarterPercentile(sorted, 3) };
}

export async function figuresFor(db: Queryable, companyIds: string[]): Promise<Map<string, CompanyFigures>> {
  const figures = new Map<string, CompanyFigures>();
  for (const id of companyIds) {
    figures.set(id, {
      rating: { overall: null, work_life: null, pay: null, management: null, review_count: 0 },
      payReports: [],
    });
  }
  const sums = await db.query<{
    company_id: string; n: number; overall: number; work_life: number; pay: number; management: number;
  }>(
    `SELECT company_id, count(*)::int AS n, sum(overall)::int AS overall, sum(work_life)::int AS work_life,
            sum(pay)::int AS pay, sum(management)::int AS management
       FROM posts
      WHERE kind = 'review' AND state = 'approved' AND deleted_at IS NULL AND company_id = ANY($1)
      GROUP BY company_id`,
    [companyIds],
  );
  for (const sum of sums.rows) {
    const entry = figures.get(sum.company_id);
    if (entry) {
      entry.rating = {
        overall: meanOneDecimal(sum.overall, sum.n),
        work_life: meanOneDecimal(sum.work_life, sum.n),
        pay: meanOneDecimal(sum.pay, sum.n),
        management: meanOneDecimal(sum.management, sum.n),
        review_count: sum.n,
      };
    }
  }
  const reports = await db.query<{ company_id: string; role_family: RoleFamilyId; city: CityId; annual_pay: number }>(
    `SELECT company_id, role_family, city, annual_pay
       FROM posts
      WHERE kind = 'pay_report' AND state = 'approved' AND deleted_at IS NULL AND company_id = ANY($1)`,
    [companyIds],
  );
  for (const report of reports.rows) {
    const entry = figures.get(report.company_id);
    if (!entry) continue;
    const row = entry.payReports.find((candidate) => candidate.role_family === report.role_family && candidate.city === report.city);
    if (row) row.amounts.push(report.annual_pay);
    else entry.payReports.push({ role_family: report.role_family, city: report.city, amounts: [report.annual_pay] });
  }
  const roleIndex = (id: string) => ROLE_FAMILIES.findIndex((role) => role.id === id);
  const cityIndex = (id: string) => CITIES.findIndex((city) => city.id === id);
  for (const entry of figures.values()) {
    entry.payReports.sort((a, b) => roleIndex(a.role_family) - roleIndex(b.role_family) || cityIndex(a.city) - cityIndex(b.city));
  }
  return figures;
}

function shownBand(amounts: number[]): PayBand | null {
  return amounts.length >= config.limits.minPayReports ? bandOf(amounts) : null;
}

export function payRowsFor(payReports: PayReports[], unlocked: boolean): PayRow[] {
  return payReports.map((report) => ({
    role_family: report.role_family,
    role_name: ROLE_FAMILIES.find((role) => role.id === report.role_family)?.name ?? report.role_family,
    city: report.city,
    city_name: CITIES.find((city) => city.id === report.city)?.name ?? report.city,
    report_count: report.amounts.length,
    threshold: config.limits.minPayReports,
    band: unlocked ? shownBand(report.amounts) : null,
  }));
}
