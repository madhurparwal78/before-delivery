import { CITIES, type CityId, type RoleFamilyId, type WorkPatternId } from '../../shared/reference';
import { config } from '../config';
import { db, transaction } from '../db/pool';
import { alertLabel, type AlertRow } from '../domain/alerts';
import { toJobSummary, type JobSummary } from '../domain/projection';
import { COPY, FieldErrors, refs, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import { sendJson, sendNoContent } from '../http/respond';
import { HANDLED, type Router } from '../http/router';
import { uuid } from '../ids';
import { runSearch, type JobDocument } from '../services/search';

interface JobRow {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  city: CityId;
  role_family: RoleFamilyId;
  remote: WorkPatternId;
  pay_low: number;
  pay_high: number;
  description: string;
  status: 'draft' | 'listed' | 'closed';
  listed_at: Date | null;
}

const JOB_COLUMNS = `j.id, j.title, j.company_id, c.name AS company_name, c.slug AS company_slug, j.city,
  j.role_family, j.remote, j.pay_low, j.pay_high, j.description, j.status, j.listed_at`;

export async function findJob(id: string): Promise<JobRow | null> {
  return db.one<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`, [
    id,
  ]);
}

function documentToSummary(document: JobDocument): JobSummary {
  return {
    id: document.id,
    title: document.title,
    company_name: document.company_name,
    company_slug: document.company_slug,
    city: document.city,
    city_name: document.city_name,
    role_family: document.role_family,
    remote: document.remote,
    pay_low: document.pay_low,
    pay_high: document.pay_high,
    pay_band: document.pay_band,
    listed_at: new Date(document.listed_at * 1000).toISOString(),
  };
}

function jobFilters(params: URLSearchParams): string[][] {
  return [
    params.getAll('city').map((value) => `city = "${value}"`),
    params.getAll('role').map((value) => `role_family = "${value}"`),
    params.getAll('remote').map((value) => `remote = "${value}"`),
    params.getAll('band').map((value) => `pay_band = "${value}"`),
  ];
}

async function listedJobsByCity(): Promise<unknown> {
  const rows = await db.query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.status = 'listed' ORDER BY j.listed_at DESC NULLS LAST, j.id`,
  );
  const cities = [...CITIES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((city) => {
      const jobs = rows.filter((row) => row.city === city.id).map(toJobSummary);
      return { city: city.id, city_name: city.name, total: jobs.length, jobs };
    })
    .filter((group) => group.total > 0);
  return { fallback: 'by_city', cities };
}

async function alertBody(alert: AlertRow): Promise<{ id: string; label: string; new_count: number }> {
  return { id: alert.id, label: alertLabel(alert), new_count: alert.new_count };
}

export function registerJobRoutes(router: Router): void {
  router.get('/api/jobs/search', async (ctx: Context) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') ?? '1') || 1);
    try {
      const outcome = await runSearch<JobDocument>('jobs', {
        q,
        filters: jobFilters(ctx.url.searchParams),
        facets: ['city', 'role_family', 'remote', 'pay_band'],
        page,
        pageSize: config.searchPageSize,
        sortNewestWhenEmpty: 'listed_at',
      });
      return {
        total: outcome.total,
        page,
        page_size: config.searchPageSize,
        hits: outcome.hits.map(documentToSummary),
        facets: {
          city: outcome.facets['city'] ?? {},
          role_family: outcome.facets['role_family'] ?? {},
          remote: outcome.facets['remote'] ?? {},
          pay_band: outcome.facets['pay_band'] ?? {},
        },
      };
    } catch {
      return listedJobsByCity();
    }
  });

  router.get('/api/jobs/suggest', async (ctx: Context) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    try {
      const outcome = await runSearch<JobDocument>('jobs', {
        q,
        filters: [],
        facets: [],
        page: 1,
        pageSize: 40,
        sortNewestWhenEmpty: 'listed_at',
      });
      const titles: string[] = [];
      for (const hit of outcome.hits) {
        if (!titles.includes(hit.title)) titles.push(hit.title);
        if (titles.length === 8) break;
      }
      return { options: titles };
    } catch {
      return { options: [] };
    }
  });

  router.get('/api/jobs/:id', async (ctx: Context) => {
    const job = await findJob(ctx.param('id'));
    if (!job) throw new ApiError('not_found');
    const ownTeam = ctx.user?.company_id === job.company_id;
    if (job.status === 'draft' && !ownTeam) throw new ApiError('not_found');
    return { ...toJobSummary(job), description: job.description, status: job.status };
  });

  router.put('/api/saved-jobs/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const job = await findJob(ctx.param('id'));
    if (!job || job.status === 'draft') throw new ApiError('not_found');
    await db.query(
      `INSERT INTO saved_jobs (user_id, job_id, saved_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, job_id) DO NOTHING`,
      [member.id, job.id, await ctx.now()],
    );
    return { saved: true };
  });

  router.delete('/api/saved-jobs/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const job = await findJob(ctx.param('id'));
    if (!job || job.status === 'draft') throw new ApiError('not_found');
    await db.query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [member.id, job.id]);
    return { saved: false };
  });

  router.get('/api/saved-jobs', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const rows = await db.query<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM saved_jobs s
         JOIN jobs j ON j.id = s.job_id
         JOIN companies c ON c.id = j.company_id
        WHERE s.user_id = $1
        ORDER BY s.saved_at DESC, j.id`,
      [member.id],
    );
    return { jobs: rows.map(toJobSummary) };
  });

  router.post('/api/alerts', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const body = ctx.json();
    const errors = new FieldErrors();
    const q = textBetween(body['q'] ?? '', 0, 200);
    if (q === null) errors.add('q', COPY.q);
    const list = (value: unknown, check: (item: unknown) => boolean, field: string, copy: string): string[] => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || !value.every(check)) {
        errors.add(field, copy);
        return [];
      }
      return value as string[];
    };
    const cities = list(body['city'], refs.isCityId, 'city', COPY.city);
    const roles = list(body['role'], refs.isRoleFamilyId, 'role', COPY.role_family);
    const remotes = list(body['remote'], refs.isWorkPatternId, 'remote', COPY.remote);
    const bands = list(body['band'], refs.isPayBandId, 'band', COPY.pay);
    errors.throwIfAny();

    const id = uuid();
    await db.query(
      `INSERT INTO alerts (id, user_id, q, cities, role_families, remotes, bands, new_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
      [id, member.id, q ?? '', cities, roles, remotes, bands, await ctx.now()],
    );
    sendJson(ctx.res, 201, {
      id,
      label: alertLabel({ q: q ?? '', cities, role_families: roles, remotes, bands }),
      new_count: 0,
    });
    return HANDLED;
  });

  router.get('/api/alerts', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const rows = await db.query<AlertRow>(
      `SELECT id, user_id, q, cities, role_families, remotes, bands, new_count, batch_opened_at
         FROM alerts WHERE user_id = $1 ORDER BY created_at, id`,
      [member.id],
    );
    return { alerts: await Promise.all(rows.map(alertBody)) };
  });

  router.post('/api/alerts/:id/seen', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const row = await transaction(async (tx) =>
      tx.one<AlertRow>(
        `UPDATE alerts SET new_count = 0 WHERE id = $1 AND user_id = $2
         RETURNING id, user_id, q, cities, role_families, remotes, bands, new_count, batch_opened_at`,
        [ctx.param('id'), member.id],
      ),
    );
    if (!row) throw new ApiError('not_found');
    return alertBody(row);
  });

  router.delete('/api/alerts/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const row = await db.one<{ id: string }>('DELETE FROM alerts WHERE id = $1 AND user_id = $2 RETURNING id', [
      ctx.param('id'),
      member.id,
    ]);
    if (!row) throw new ApiError('not_found');
    sendNoContent(ctx.res);
    return HANDLED;
  });
}
