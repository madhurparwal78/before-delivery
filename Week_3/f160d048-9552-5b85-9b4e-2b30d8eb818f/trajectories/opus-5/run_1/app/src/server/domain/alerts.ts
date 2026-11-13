import { cityName, moneyRange, payBandName, roleFamilyName, workPatternName } from '../../shared/reference';
import { config } from '../config';
import { db, transaction, type Db } from '../db/pool';
import { letters, queueLetter } from '../services/mail';
import { publish } from '../services/live';
import { runSearch } from '../services/search';

export interface AlertRow {
  id: string;
  user_id: string;
  q: string;
  cities: string[];
  role_families: string[];
  remotes: string[];
  bands: string[];
  new_count: number;
  batch_opened_at: Date | null;
}

/** Trimmed query text, then each chip label in facet order and list order. */
export function alertLabel(alert: Pick<AlertRow, 'q' | 'cities' | 'role_families' | 'remotes' | 'bands'>): string {
  const parts: string[] = [];
  const text = alert.q.trim();
  if (text) parts.push(text);
  parts.push(...alert.cities.map(cityName));
  parts.push(...alert.role_families.map(roleFamilyName));
  parts.push(...alert.remotes.map(workPatternName));
  parts.push(...alert.bands.map(payBandName));
  return parts.length === 0 ? 'All jobs' : parts.join(', ');
}

function chipFilters(alert: AlertRow): string[][] {
  return [
    alert.cities.map((city) => `city = "${city}"`),
    alert.role_families.map((role) => `role_family = "${role}"`),
    alert.remotes.map((remote) => `remote = "${remote}"`),
    alert.bands.map((band) => `pay_band = "${band}"`),
  ];
}

interface ListedJob {
  id: string;
  company_id: string;
  city: string;
  role_family: string;
  remote: string;
  pay_band: string;
}

function chipsSatisfied(alert: AlertRow, job: ListedJob): boolean {
  if (alert.cities.length > 0 && !alert.cities.includes(job.city)) return false;
  if (alert.role_families.length > 0 && !alert.role_families.includes(job.role_family)) return false;
  if (alert.remotes.length > 0 && !alert.remotes.includes(job.remote)) return false;
  if (alert.bands.length > 0 && !alert.bands.includes(job.pay_band)) return false;
  return true;
}

async function textFinds(alert: AlertRow, job: ListedJob): Promise<boolean> {
  const outcome = await runSearch<{ id: string }>('jobs', {
    q: alert.q.trim(),
    filters: [[`company_id = "${job.company_id}"`], ...chipFilters(alert)],
    facets: [],
    page: 1,
    pageSize: 200,
  });
  return outcome.hits.some((hit) => hit.id === job.id);
}

/** A newly listed job matches every alert whose chips it satisfies and whose text search returns it. */
export async function matchNewlyListedJob(job: ListedJob, now: Date): Promise<void> {
  const alerts = await db.query<AlertRow>(
    `SELECT id, user_id, q, cities, role_families, remotes, bands, new_count, batch_opened_at FROM alerts`,
  );
  for (const alert of alerts) {
    if (!chipsSatisfied(alert, job)) continue;
    if (alert.q.trim() !== '' && !(await textFinds(alert, job))) continue;
    await transaction(async (tx) => {
      const updated = await tx.one<{ new_count: number }>(
        `UPDATE alerts SET new_count = new_count + 1,
                batch_opened_at = COALESCE(batch_opened_at, $2)
           WHERE id = $1 RETURNING new_count`,
        [alert.id, now],
      );
      await tx.query(
        `INSERT INTO alert_batch_jobs (alert_id, job_id, matched_at) VALUES ($1, $2, $3)
         ON CONFLICT (alert_id, job_id) DO NOTHING`,
        [alert.id, job.id, now],
      );
      await publish(
        tx,
        now,
        'alert.matched',
        { alert_id: alert.id, new_count: updated?.new_count ?? 0 },
        {
          user_ids: [alert.user_id],
        },
      );
    });
  }
}

/** One email per alert, once `ALERT_BATCH_SECONDS` have passed since the batch opened. */
export async function sendDueAlertBatches(now: Date): Promise<void> {
  const due = await db.query<AlertRow & { email: string }>(
    `SELECT a.id, a.user_id, a.q, a.cities, a.role_families, a.remotes, a.bands, a.new_count, a.batch_opened_at,
            u.email
       FROM alerts a JOIN users u ON u.id = a.user_id
      WHERE a.batch_opened_at IS NOT NULL AND a.batch_opened_at <= $1`,
    [new Date(now.getTime() - config.alertBatchSeconds * 1000)],
  );
  for (const alert of due) {
    await transaction(async (tx: Db) => {
      const claimed = await tx.one<{ id: string }>(
        `UPDATE alerts SET batch_opened_at = NULL WHERE id = $1 AND batch_opened_at IS NOT NULL RETURNING id`,
        [alert.id],
      );
      if (!claimed) return;
      const jobs = await tx.query<{
        id: string;
        title: string;
        company_name: string;
        city: string;
        pay_low: number;
        pay_high: number;
      }>(
        `SELECT j.id, j.title, c.name AS company_name, j.city, j.pay_low, j.pay_high
           FROM alert_batch_jobs b
           JOIN jobs j ON j.id = b.job_id
           JOIN companies c ON c.id = j.company_id
          WHERE b.alert_id = $1 AND j.status = 'listed'
          ORDER BY j.listed_at DESC NULLS LAST, j.id`,
        [alert.id],
      );
      await tx.query('DELETE FROM alert_batch_jobs WHERE alert_id = $1', [alert.id]);
      if (jobs.length === 0) return;
      await queueLetter(
        tx,
        now,
        letters.jobAlert(
          alert.email,
          alertLabel(alert),
          jobs.map((job) => ({
            id: job.id,
            title: job.title,
            companyName: job.company_name,
            cityName: cityName(job.city),
            payRange: moneyRange(job.pay_low, job.pay_high),
          })),
        ),
      );
    });
  }
}
