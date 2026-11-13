// Employers, jobs, saved jobs, alerts and applications.
import crypto from 'node:crypto';
import type { RouteContext } from './http.js';
import { route, sendJson, type Route } from './http.js';
import { errors } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { randomId, nowMs, now, isoDate } from '../lib/clock.js';
import {
  CITIES,
  ROLE_FAMILIES,
  WORK_PATTERNS,
  STAGES,
  payBandFor,
  cityName,
  roleName,
  rupees,
  rangeText,
} from '../lib/reference.js';
import {
  text,
  isEmail,
  isPhone,
  COPY,
  requireString,
  requireInt,
  requireEnum,
  throwFields,
  type Body,
  type Fields,
} from '../lib/validation.js';
import { meili } from '../lib/meili.js';
import { s3 } from '../lib/s3.js';
import { companyView } from './projection.js';
import { jobDoc, indexJob, deleteJobDoc, queueSync, indexCompany } from './search.js';
import { matchAlerts } from './jobs.js';
import { outboxInsert, bodyOf } from './routes-posts.js';

const CITY_IDS: string[] = CITIES.map((c) => c.id);
const ROLE_IDS: string[] = ROLE_FAMILIES.map((r) => r.id);
const REMOTE_IDS: string[] = WORK_PATTERNS.map((w) => w.id);
const BAND_IDS: string[] = ['under_4', '4_6', '6_8', '8_10', '10_plus'];

interface JobRow {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city: string;
  role_family: string;
  remote: string;
  pay_low: number;
  pay_high: number;
  description: string;
  status: string;
  listed_at: Date | null;
}

async function jobOr404(ctx: RouteContext, id: string, opts?: { teamOnly?: boolean }): Promise<JobRow> {
  const row = await ctx.app.db.one<JobRow>(
    `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.description, j.status, j.listed_at,
       c.name as company_name, c.slug as company_slug, j.company_id
     from jobs j join companies c on c.id = j.company_id where j.id = $1`,
    [id],
  );
  if (!row) throw errors.notFound();
  const viewerSlug = ctx.user?.company_slug ?? null;
  if (opts?.teamOnly) {
    if (viewerSlug !== row.company_slug) throw errors.notFound();
  } else if (row.status !== 'listed' && viewerSlug !== row.company_slug) {
    throw errors.notFound();
  }
  return row;
}

function jobSummary(row: JobRow) {
  return {
    id: row.id,
    title: row.title,
    company_name: row.company_name,
    company_slug: row.company_slug,
    city: row.city,
    city_name: cityName(row.city),
    role_family: row.role_family,
    remote: row.remote,
    pay_low: row.pay_low,
    pay_high: row.pay_high,
    pay_band: payBandFor(row.pay_low),
    listed_at: row.listed_at ? Math.floor(row.listed_at.getTime() / 1000) : null,
  };
}

function alertLabel(q: string, cities: string[], roles: string[], remotes: string[], bands: string[]): string {
  const parts: string[] = [];
  const trimmed = q.trim();
  if (trimmed) parts.push(trimmed);
  for (const id of cities) parts.push(cityName(id));
  for (const id of roles) parts.push(roleName(id));
  for (const id of remotes) parts.push(WORK_PATTERNS.find((w) => w.id === id)?.name ?? id);
  for (const id of bands) parts.push(
    { under_4: 'Under ₹4 lakh', '4_6': '₹4–6 lakh', '6_8': '₹6–8 lakh', '8_10': '₹8–10 lakh', '10_plus': '₹10 lakh and over' }[id] ?? id,
  );
  return parts.length === 0 ? 'All jobs' : parts.join(', ');
}

async function recordUpload(ctx: RouteContext, kind: string): Promise<void> {
  await ctx.app.db.query('insert into upload_log (user_id, kind) values ($1, $2)', [ctx.user!.id, kind]);
}

async function tooManyUploads(ctx: RouteContext, kind: string): Promise<boolean> {
  const windowStart = new Date(nowMs() - 60 * 1000);
  const row = await ctx.app.db.one<{ n: number }>(
    'select count(*)::int as n from upload_log where user_id = $1 and kind = $2 and at > $3',
    [ctx.user!.id, kind, windowStart],
  );
  return (row?.n ?? 0) >= config().uploadRatePerMinute;
}

export const routes: Route[] = [
  // ----- search -----
  route('GET', '/api/jobs/search', async (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const cities = ctx.url.searchParams.getAll('city');
    const roles = ctx.url.searchParams.getAll('role');
    const remotes = ctx.url.searchParams.getAll('remote');
    const bands = ctx.url.searchParams.getAll('band');
    const page = Math.max(1, Number.parseInt(ctx.url.searchParams.get('page') ?? '1', 10) || 1);
    const size = config().searchPageSize;
    const filters: string[] = [];
    if (cities.length) filters.push(`city IN [${cities.map((c) => `"${c}"`).join(', ')}]`);
    if (roles.length) filters.push(`role_family IN [${roles.map((r) => `"${r}"`).join(', ')}]`);
    if (remotes.length) filters.push(`remote IN [${remotes.map((r) => `"${r}"`).join(', ')}]`);
    if (bands.length) filters.push(`pay_band IN [${bands.map((b) => `"${b}"`).join(', ')}]`);
    try {
      const result = await meili.search('jobs', {
        q,
        limit: size,
        offset: (page - 1) * size,
        facets: ['city', 'role_family', 'remote', 'pay_band'],
        filter: filters.length ? filters.join(' AND ') : undefined,
        sort: q.trim().length === 0 ? ['listed_at:desc'] : undefined,
      });
      const hits = (result.hits as unknown as Record<string, unknown>[]) ?? [];
      sendJson(ctx.res, 200, {
        total: result.estimatedTotalHits ?? hits.length,
        page,
        page_size: size,
        hits: hits.map((hit) => ({
          id: hit.id,
          title: hit.title,
          company_name: hit.company_name,
          company_slug: hit.company_slug,
          city: hit.city,
          city_name: hit.city_name,
          role_family: hit.role_family,
          remote: hit.remote,
          pay_low: hit.pay_low,
          pay_high: hit.pay_high,
          pay_band: hit.pay_band,
          listed_at: hit.listed_at,
        })),
        facets: {
          city: (result.facetDistribution?.city as Record<string, number>) ?? {},
          role_family: (result.facetDistribution?.role_family as Record<string, number>) ?? {},
          remote: (result.facetDistribution?.remote as Record<string, number>) ?? {},
          pay_band: (result.facetDistribution?.pay_band as Record<string, number>) ?? {},
        },
      });
    } catch {
      // Fallback from PostgreSQL: every listed job, cities in alphabetical order.
      const rows = await ctx.app.db.many<JobRow & { company_id: string }>(
        `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.listed_at, j.company_id,
          c.name as company_name, c.slug as company_slug
         from jobs j join companies c on c.id = j.company_id
         where j.status = 'listed' order by j.listed_at desc`,
      );
      const cityMap = new Map<string, { city: string; city_name: string; total: number; jobs: unknown[] }>();
      for (const row of rows) {
        const entry = cityMap.get(row.city) ?? { city: row.city, city_name: cityName(row.city), total: 0, jobs: [] as unknown[] };
        entry.jobs.push(jobSummary(row));
        entry.total += 1;
        cityMap.set(row.city, entry);
      }
      const cities2 = [...cityMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, value]) => ({ ...value, city: id }));
      sendJson(ctx.res, 200, { fallback: 'by_city', cities: cities2 });
    }
  }),

  route('GET', '/api/jobs/suggest', async (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    try {
      const result = await meili.search('jobs', { q, limit: 20 });
      const hits = (result.hits as unknown as { title: string }[]) ?? [];
      const titles: string[] = [];
      for (const hit of hits) {
        if (!titles.includes(hit.title)) titles.push(hit.title);
        if (titles.length >= 8) break;
      }
      sendJson(ctx.res, 200, { options: titles });
    } catch {
      sendJson(ctx.res, 200, { options: [] });
    }
  }),

  route('GET', '/api/jobs/:id', async (ctx) => {
    const row = await jobOr404(ctx, ctx.params.id);
    sendJson(ctx.res, 200, { ...jobSummary(row), description: row.description, status: row.status });
  }),

  // ----- saved jobs -----
  route('PUT', '/api/saved-jobs/:id', async (ctx) => {
    const job = await ctx.app.db.one<{ id: string; status: string }>(
      'select id, status from jobs where id = $1',
      [ctx.params.id],
    );
    if (!job || job.status !== 'listed') throw errors.notFound();
    await ctx.app.db.query(
      `insert into saved_jobs (user_id, job_id) values ($1, $2) on conflict do nothing`,
      [ctx.user!.id, job.id],
    );
    sendJson(ctx.res, 200, { saved: true });
  }, 'member'),

  route('DELETE', '/api/saved-jobs/:id', async (ctx) => {
    await ctx.app.db.query('delete from saved_jobs where user_id = $1 and job_id = $2', [ctx.user!.id, ctx.params.id]);
    sendJson(ctx.res, 200, { saved: false });
  }, 'member'),

  route('GET', '/api/saved-jobs', async (ctx) => {
    const rows = await ctx.app.db.many<JobRow>(
      `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.listed_at, j.status,
        c.name as company_name, c.slug as company_slug
       from saved_jobs s
       join jobs j on j.id = s.job_id
       join companies c on c.id = j.company_id
       where s.user_id = $1 and j.status = 'listed'
       order by s.saved_at desc`,
      [ctx.user!.id],
    );
    sendJson(ctx.res, 200, { jobs: rows.map(jobSummary) });
  }, 'member'),

  // ----- alerts -----
  route('POST', '/api/alerts', async (ctx) => {
    const b = bodyOf(ctx) as Body & { city?: string[]; role?: string[]; remote?: string[]; band?: string[] };
    const fields: Fields = {};
    const q = typeof b.q === 'string' ? b.q : '';
    const cities = Array.isArray(b.city) ? b.city.filter((c) => typeof c === 'string' && CITY_IDS.includes(c)) : [];
    const roles = Array.isArray(b.role) ? b.role.filter((r) => typeof r === 'string' && ROLE_IDS.includes(r)) : [];
    const remotes = Array.isArray(b.remote) ? b.remote.filter((r) => typeof r === 'string' && REMOTE_IDS.includes(r)) : [];
    const bands = Array.isArray(b.band) ? b.band.filter((x) => typeof x === 'string' && BAND_IDS.includes(x)) : [];
    if (typeof b.q !== 'string') fields.q = 'Check the highlighted fields.';
    throwFields(fields);
    const id = randomId();
    await ctx.app.db.query(
      'insert into alerts (id, user_id, q, cities, roles, remotes, bands) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, ctx.user!.id, q, cities, roles, remotes, bands],
    );
    sendJson(ctx.res, 201, { id, label: alertLabel(q, cities, roles, remotes, bands), new_count: 0 });
  }, 'member'),

  route('GET', '/api/alerts', async (ctx) => {
    const rows = await ctx.app.db.many<{
      id: string;
      q: string;
      cities: string[];
      roles: string[];
      remotes: string[];
      bands: string[];
      new_count: number;
    }>('select id, q, cities, roles, remotes, bands, new_count from alerts where user_id = $1 order by created_at asc', [
      ctx.user!.id,
    ]);
    sendJson(ctx.res, 200, {
      alerts: rows.map((row) => ({
        id: row.id,
        label: alertLabel(row.q, row.cities, row.roles, row.remotes, row.bands),
        new_count: row.new_count,
      })),
    });
  }, 'member'),

  route('POST', '/api/alerts/:id/seen', async (ctx) => {
    const row = await ctx.app.db.one<{ id: string; q: string; cities: string[]; roles: string[]; remotes: string[]; bands: string[] }>(
      'select id, q, cities, roles, remotes, bands from alerts where id = $1 and user_id = $2',
      [ctx.params.id, ctx.user!.id],
    );
    if (!row) throw errors.notFound();
    await ctx.app.db.query('update alerts set new_count = 0 where id = $1', [row.id]);
    sendJson(ctx.res, 200, { id: row.id, label: alertLabel(row.q, row.cities, row.roles, row.remotes, row.bands), new_count: 0 });
  }, 'member'),

  route('DELETE', '/api/alerts/:id', async (ctx) => {
    const row = await ctx.app.db.one<{ id: string }>('select id from alerts where id = $1 and user_id = $2', [
      ctx.params.id,
      ctx.user!.id,
    ]);
    if (!row) throw errors.notFound();
    await ctx.app.db.query('delete from alerts where id = $1', [row.id]);
    ctx.res.writeHead(204);
    ctx.res.end();
  }, 'member'),

  // ----- apply -----
  route('POST', '/api/jobs/:id/applications', async (ctx) => {
    const job = await jobOr404(ctx, ctx.params.id);
    if (job.status === 'closed') throw errors.jobClosed();
    const user = ctx.user!;
    const contentType = String(ctx.req.headers['content-type'] ?? '');
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    const idempotencyKey = String(ctx.req.headers['idempotency-key'] ?? '');
    const fields: Fields = {};
    if (!idempotencyKey) fields.idempotency_key = 'Reload the form and try again.';
    const parsed = await readMultipart(ctx, boundaryMatch ? boundaryMatch[1] || boundaryMatch[2] : null, config().resumeMaxBytes + 1048576);
    const candidateName = requireString(parsed.values, 'candidate_name', 2, 100, COPY.candidate_name, fields);
    const contactEmail = requireString(parsed.values, 'contact_email', 3, 320, COPY.email, fields).trim();
    if (!isEmail(contactEmail)) fields.contact_email = COPY.email;
    const phoneRaw = text(parsed.values.phone);
    const phone = phoneRaw.trim();
    if (phone.length > 0 && !isPhone(phone)) fields.phone = COPY.phone;
    const coverNote = text(parsed.values.cover_note);
    if (coverNote.length > 2000) fields.cover_note = COPY.cover_note;
    const resume = parsed.files.resume;
    if (!resume) fields.resume = COPY.resume;
    throwFields(fields);
    if (resume && !(resume.data.length >= 5 && resume.data.subarray(0, 5).toString('latin1') === '%PDF-')) {
      throw errors.resumeNotPdf();
    }
    if (resume && resume.data.length > config().resumeMaxBytes) {
      throw errors.resumeTooLarge();
    }
    if (await tooManyUploads(ctx, 'apply')) {
      throw errors.rateLimited(60);
    }

    // Idempotency: one key per form.
    const answerHash = crypto
      .createHash('sha256')
      .update(JSON.stringify([candidateName, contactEmail, phone, coverNote, resume?.data.length ?? 0, crypto.createHash('sha256').update(resume?.data ?? Buffer.alloc(0)).digest('hex')]))
      .digest('hex');
    const existingKey = await ctx.app.db.one<{ answer_hash: string; response: object }>(
      'select answer_hash, response from apply_keys where key = $1 and user_id = $2 and job_id = $3',
      [idempotencyKey, user.id, job.id],
    );
    if (existingKey) {
      if (existingKey.answer_hash !== answerHash) throw errors.idempotencyMismatch();
      const stored = existingKey.response as { status: number; body: unknown };
      sendJson(ctx.res, stored.status, stored.body);
      return;
    }
    const duplicate = await ctx.app.db.one<{ id: string }>(
      'select id from applications where job_id = $1 and user_id = $2',
      [job.id, user.id],
    );
    if (duplicate) throw errors.duplicateApplication();

    const resumeId = randomId();
    try {
      await s3.put(`resumes/${resumeId}.pdf`, resume!.data, { contentType: 'application/pdf' });
      const size = await s3.stat(`resumes/${resumeId}.pdf`);
      if (size !== resume!.data.length) throw new Error('storage did not confirm');
    } catch {
      throw errors.storageUnavailable();
    }
    const applicationId = randomId();
    const result = await ctx.app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const again = await client.query('select id from applications where job_id = $1 and user_id = $2 for update', [
          job.id,
          user.id,
        ]);
        if (again.rows.length > 0) {
          await client.query('rollback');
          throw errors.duplicateApplication();
        }
        await client.query(
          `insert into applications (id, job_id, user_id, candidate_name, contact_email, phone, cover_note, stage, resume_file_id, applied_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, now(), now())`,
          [applicationId, job.id, user.id, candidateName, contactEmail, phone, coverNote, resumeId],
        );
        await client.query(`insert into stage_history (application_id, stage) values ($1, 'submitted')`, [applicationId]);
        await client.query(
          'insert into files (id, kind, content_type, size_bytes) values ($1, $2, $3, $4)',
          [resumeId, 'resume', 'application/pdf', resume!.data.length],
        );
        await client.query(
          'insert into apply_keys (key, user_id, job_id, answer_hash, response) values ($1, $2, $3, $4, $5)',
          [idempotencyKey, user.id, job.id, answerHash, JSON.stringify({ status: 201, body: null })],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    void result;
    await recordUpload(ctx, 'apply');
    const body = {
      id: applicationId,
      job_id: job.id,
      stage: 'submitted',
      resume_file_id: resumeId,
      applied_on: isoDate(now()),
    };
    await ctx.app.db.query('update apply_keys set response = $2 where key = $1', [
      idempotencyKey,
      JSON.stringify({ status: 201, body }),
    ]);
    sendJson(ctx.res, 201, body);
  }, 'member'),

  route('GET', '/api/me/applications', async (ctx) => {
    const rows = await ctx.app.db.many<{
      id: string;
      job_id: string;
      job_title: string;
      company_name: string;
      stage: string;
      applied_at: Date;
      updated_at: Date;
    }>(
      `select a.id, a.job_id, a.stage, a.applied_at, a.updated_at, j.title as job_title, c.name as company_name
       from applications a
       join jobs j on j.id = a.job_id
       join companies c on c.id = j.company_id
       where a.user_id = $1 order by a.applied_at desc`,
      [ctx.user!.id],
    );
    sendJson(ctx.res, 200, {
      applications: rows.map((row) => ({
        id: row.id,
        job_id: row.job_id,
        job_title: row.job_title,
        company_name: row.company_name,
        stage: row.stage,
        applied_on: isoDate(row.applied_at),
        updated_on: isoDate(row.updated_at),
      })),
    });
  }, 'member'),

  route('GET', '/api/applications/:id', async (ctx) => {
    const row = await ctx.app.db.one<{
      id: string;
      job_id: string;
      job_title: string;
      company_name: string;
      company_slug: string;
      candidate_name: string;
      contact_email: string;
      phone: string;
      cover_note: string;
      stage: string;
      applied_at: Date;
      updated_at: Date;
      resume_file_id: string;
      user_id: string;
    }>(
      `select a.id, a.job_id, a.candidate_name, a.contact_email, a.phone, a.cover_note, a.stage, a.applied_at, a.updated_at,
        a.resume_file_id, a.user_id, j.title as job_title, c.name as company_name, c.slug as company_slug
       from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id
       where a.id = $1`,
      [ctx.params.id],
    );
    if (!row) throw errors.notFound();
    const isCandidate = row.user_id === ctx.user!.id;
    const isTeam = ctx.user!.company_slug === row.company_slug;
    if (!isCandidate && !isTeam) throw errors.notFound();
    sendJson(ctx.res, 200, {
      id: row.id,
      job_id: row.job_id,
      job_title: row.job_title,
      company_name: row.company_name,
      stage: row.stage,
      applied_on: isoDate(row.applied_at),
      updated_on: isoDate(row.updated_at),
      candidate_name: row.candidate_name,
      contact_email: row.contact_email,
      phone: row.phone,
      cover_note: row.cover_note,
      resume_file_id: row.resume_file_id,
    });
  }, 'member'),

  route('GET', '/api/files/:id', async (ctx) => {
    const row = await ctx.app.db.one<{ id: string; kind: string; content_type: string; company_id: string | null }>(
      'select id, kind, content_type, company_id from files where id = $1',
      [ctx.params.id],
    );
    if (!row) throw errors.notFound();
    let allowed = false;
    if (row.kind === 'mark') {
      allowed = true;
    } else {
      const app = await ctx.app.db.one<{ user_id: string; job_id: string }>(
        'select user_id, job_id from applications where resume_file_id = $1',
        [row.id],
      );
      if (!app) throw errors.notFound();
      if (!ctx.user) throw errors.unauthenticated();
      if (app.user_id === ctx.user.id) allowed = true;
      else {
        const job = await ctx.app.db.one<{ company_slug: string }>(
          'select c.slug as company_slug from jobs j join companies c on c.id = j.company_id where j.id = $1',
          [app.job_id],
        );
        if (job && ctx.user.company_slug === job.company_slug) allowed = true;
      }
    }
    if (!allowed) throw errors.notFound();
    const key = row.kind === 'mark' ? `marks/${row.company_id}.png` : `resumes/${row.id}.pdf`;
    let bytes: Buffer;
    try {
      bytes = await s3.get(key);
    } catch {
      throw errors.notFound();
    }
    ctx.res.writeHead(200, {
      'content-type': row.content_type,
      'content-length': String(bytes.length),
      'cache-control': 'private, no-store',
    });
    ctx.res.end(bytes);
  }),

  // ----- employer -----
  route('POST', '/api/employer/verification/request', async (ctx) => {
    const b = bodyOf(ctx);
    const fields: Fields = {};
    const email = requireString(b, 'email', 3, 320, COPY.email, fields).trim().toLowerCase();
    const company = await ctx.app.db.one<{ id: string; slug: string; email_domain: string }>(
      'select id, slug, email_domain from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!isEmail(email)) {
      fields.email = `${COPY.verification_email} ${company.email_domain}.`;
      throwFields(fields);
    }
    if (!email.endsWith(`@${company.email_domain}`)) {
      fields.email = `${COPY.verification_email} ${company.email_domain}.`;
      throwFields(fields);
    }
    const cutoff = new Date(nowMs() - config().emailCodeTtlSeconds * 1000);
    const recent = await ctx.app.db.one<{ n: number }>(
      'select count(*)::int as n from verification_codes where company_id = $1 and created_at > $2',
      [company.id, cutoff],
    );
    if ((recent?.n ?? 0) >= 3) throw errors.rateLimited(config().emailCodeTtlSeconds);
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    await ctx.app.db.query('delete from verification_codes where company_id = $1', [company.id]);
    await ctx.app.db.query(
      'insert into verification_codes (id, company_id, code, email, expires_at) values ($1, $2, $3, $4, $5)',
      [randomId(), company.id, code, email, new Date(nowMs() + config().emailCodeTtlSeconds * 1000)],
    );
    sendJson(ctx.res, 202, { status: 'queued' });
    const minutes = Math.ceil(config().emailCodeTtlSeconds / 60);
    await outboxInsert(
      ctx.app,
      'verification_code',
      email,
      'Your Candour Bench verification code',
      `Your code is ${code}. It expires in ${minutes} minutes.`,
    );
  }, 'employerAdmin'),

  route('POST', '/api/employer/verification/confirm', async (ctx) => {
    const b = bodyOf(ctx);
    const code = text(b.code);
    const company = await ctx.app.db.one<{ id: string; slug: string }>('select id, slug from companies where slug = $1', [
      ctx.user!.company_slug,
    ]);
    if (!company) throw errors.notFound();
    const row = await ctx.app.db.one<{ id: string; code: string; expires_at: Date }>(
      'select id, code, expires_at from verification_codes where company_id = $1 order by created_at desc limit 1',
      [company.id],
    );
    if (!row || row.code !== code) throw errors.codeInvalid();
    if (row.expires_at.getTime() <= nowMs()) throw errors.codeExpired();
    await ctx.app.db.query('update companies set verified = true where id = $1', [company.id]);
    await ctx.app.db.query('delete from verification_codes where company_id = $1', [company.id]);
    await indexCompany(ctx.app, company.slug).catch(() => undefined);
    const view = await companyView(ctx.app, company.slug, null);
    ctx.app.live.publish({ type: 'company.changed', data: { slug: company.slug, company: view } });
    sendJson(ctx.res, 200, { verified: true });
  }, 'employerAdmin'),

  route('POST', '/api/employer/reviews/:id/reply', async (ctx) => {
    const b = bodyOf(ctx);
    const fields: Fields = {};
    const bodyText = requireString(b, 'body', 20, 2000, COPY.reply_body, fields);
    throwFields(fields);
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(bodyText)) throw errors.containsEmail('body');
    if (/\+?\d(?:[ .-]?\d){6,}/.test(bodyText)) throw errors.containsPhone('body');
    const company = await ctx.app.db.one<{ id: string; slug: string; name: string; verified: boolean }>(
      'select id, slug, name, verified from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!company.verified) throw errors.notVerified();
    const review = await ctx.app.db.one<{ id: string; company_id: string }>(
      "select id, company_id from posts where id = $1 and kind = 'review' and state = 'approved'",
      [ctx.params.id],
    );
    if (!review || review.company_id !== company.id) throw errors.notFound();
    const existing = await ctx.app.db.one<{ review_id: string }>('select review_id from replies where review_id = $1', [
      review.id,
    ]);
    if (existing) throw errors.alreadyReplied();
    const postedMonth = `${now().getUTCFullYear()}-${String(now().getUTCMonth() + 1).padStart(2, '0')}`;
    try {
      await ctx.app.db.query(
        'insert into replies (review_id, company_id, body, posted_month) values ($1, $2, $3, $4)',
        [review.id, company.id, bodyText, postedMonth],
      );
    } catch {
      throw errors.alreadyReplied();
    }
    const view = await companyView(ctx.app, company.slug, null);
    ctx.app.live.publish({ type: 'company.changed', data: { slug: company.slug, company: view } });
    sendJson(ctx.res, 201, { review_id: review.id, company_name: company.name, body: bodyText, posted_month: postedMonth });
  }, 'team'),

  route('POST', '/api/employer/jobs', async (ctx) => {
    const company = await ctx.app.db.one<{ id: string; slug: string; name: string; verified: boolean }>(
      'select id, slug, name, verified from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!company.verified) throw errors.notVerified();
    const b = bodyOf(ctx);
    const fields: Fields = {};
    const title = requireString(b, 'title', 3, 120, COPY.title_job, fields);
    const role_family = requireEnum(b, 'role_family', ROLE_IDS as unknown as string[], COPY.role_family, fields);
    const city = requireEnum(b, 'city', CITY_IDS as unknown as string[], COPY.city, fields);
    const remote = requireEnum(b, 'remote', REMOTE_IDS as unknown as string[], COPY.remote, fields);
    const pay_low = requireInt(b, 'pay_low', 100000, 5000000, COPY.pay, fields);
    const pay_high = requireInt(b, 'pay_high', 100000, 5000000, COPY.pay, fields);
    if (typeof b.pay_high === 'number' && typeof b.pay_low === 'number' && b.pay_high < b.pay_low) {
      fields.pay_high = COPY.pay_order;
    }
    const description = requireString(b, 'description', 40, 5000, COPY.description, fields);
    throwFields(fields);
    const id = randomId();
    await ctx.app.db.query(
      `insert into jobs (id, company_id, title, role_family, city, remote, pay_low, pay_high, description, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
      [id, company.id, title, role_family, city, remote, pay_low, pay_high, description],
    );
    // Index first; only then does the job become listed.
    try {
      await ctx.app.db.query(
        `update jobs set status = 'listed', listed_at = now() where id = $1 and status = 'draft'`,
        [id],
      );
      const ok = await indexJob(ctx.app, id);
      if (!ok) throw new Error('index failed');
      const row = await jobFull(ctx, id);
      await matchAlerts(ctx.app, id);
      sendJson(ctx.res, 201, { ...jobSummary(row), status: row.status });
    } catch {
      await ctx.app.db.query(`update jobs set status = 'draft', listed_at = null where id = $1`, [id]);
      await queueSync(ctx.app, 'job', id, 'upsert');
      throw errors.searchUnavailable();
    }
  }, 'team'),

  route('POST', '/api/employer/jobs/:id/list', async (ctx) => {
    const company = await ctx.app.db.one<{ id: string; slug: string; verified: boolean }>(
      'select id, slug, verified from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!company.verified) throw errors.notVerified();
    const job = await jobFull(ctx, ctx.params.id);
    if (job.company_slug !== company.slug) throw errors.notFound();
    if (job.status === 'listed') {
      sendJson(ctx.res, 200, jobSummary(job));
      return;
    }
    try {
      await ctx.app.db.query(
        `update jobs set status = 'listed', listed_at = now() where id = $1 and status in ('draft','closed')`,
        [job.id],
      );
      await indexJob(ctx.app, job.id);
      const row = await jobFull(ctx, ctx.params.id);
      await matchAlerts(ctx.app, job.id);
      sendJson(ctx.res, 200, { ...jobSummary(row), status: row.status });
    } catch {
      await ctx.app.db.query(`update jobs set status = 'draft', listed_at = null where id = $1`, [job.id]);
      await queueSync(ctx.app, 'job', job.id, 'upsert');
      throw errors.searchUnavailable();
    }
  }, 'team'),

  route('POST', '/api/employer/jobs/:id/close', async (ctx) => {
    const company = await ctx.app.db.one<{ id: string; slug: string; verified: boolean }>(
      'select id, slug, verified from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!company.verified) throw errors.notVerified();
    const job = await jobFull(ctx, ctx.params.id);
    if (job.company_slug !== company.slug) throw errors.notFound();
    await ctx.app.db.query(`update jobs set status = 'closed' where id = $1`, [job.id]);
    try {
      await deleteJobDoc(job.id);
    } catch {
      await queueSync(ctx.app, 'job', job.id, 'delete');
    }
    const row = await jobFull(ctx, ctx.params.id);
    sendJson(ctx.res, 200, { ...jobSummary(row), status: row.status });
  }, 'team'),

  route('GET', '/api/employer/jobs', async (ctx) => {
    const rows = await ctx.app.db.many<JobRow & { status: string }>(
      `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.listed_at, j.status,
        c.name as company_name, c.slug as company_slug
       from jobs j join companies c on c.id = j.company_id where c.slug = $1 order by j.created_at desc`,
      [ctx.user!.company_slug],
    );
    sendJson(ctx.res, 200, { jobs: rows.map((row) => ({ ...jobSummary(row), status: row.status })) });
  }, 'team'),

  route('GET', '/api/employer/jobs/:id/applicants', async (ctx) => {
    const job = await jobFull(ctx, ctx.params.id);
    if (job.company_slug !== ctx.user!.company_slug) throw errors.notFound();
    const rows = await applicantRows(ctx, job.id);
    sendJson(ctx.res, 200, { applicants: rows });
  }, 'team'),

  route('GET', '/api/employer/applications/:id', async (ctx) => {
    const row = await ctx.app.db.one<{
      id: string;
      job_id: string;
      company_slug: string;
      candidate_name: string;
      contact_email: string;
      phone: string;
      cover_note: string;
      stage: string;
      applied_at: Date;
      updated_at: Date;
      resume_file_id: string;
    }>(
      `select a.id, a.job_id, a.candidate_name, a.contact_email, a.phone, a.cover_note, a.stage, a.applied_at, a.updated_at,
        a.resume_file_id, c.slug as company_slug
       from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id
       where a.id = $1`,
      [ctx.params.id],
    );
    if (!row || row.company_slug !== ctx.user!.company_slug) throw errors.notFound();
    sendJson(ctx.res, 200, applicantShape(row, row.job_id));
  }, 'team'),

  route('POST', '/api/employer/applications/:id/stage', async (ctx) => {
    const b = bodyOf(ctx);
    const fields: Fields = {};
    const stage = requireEnum(b, 'stage', STAGES as unknown as string[], 'Choose a stage.', fields);
    throwFields(fields);
    const row = await ctx.app.db.one<{
      id: string;
      job_id: string;
      stage: string;
      company_slug: string;
      contact_email: string;
      job_title: string;
      company_name: string;
    }>(
      `select a.id, a.job_id, a.stage, a.contact_email, c.slug as company_slug, j.title as job_title, c.name as company_name
       from applications a join jobs j on j.id = a.job_id join companies c on c.id = j.company_id
       where a.id = $1`,
      [ctx.params.id],
    );
    if (!row || row.company_slug !== ctx.user!.company_slug) throw errors.notFound();
    if (!legalMove(row.stage, stage!)) throw errors.invalidTransition();
    const result = await ctx.app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const fresh = await client.query<{ stage: string }>('select stage from applications where id = $1 for update', [
          row.id,
        ]);
        const current: string | undefined = fresh.rows[0]?.stage as string | undefined;
        if (!current) {
          await client.query('rollback');
          throw errors.notFound();
        }
        if (!legalMove(current, stage!)) {
          await client.query('rollback');
          throw errors.invalidTransition();
        }
        await client.query('update applications set stage = $2, updated_at = now() where id = $1', [row.id, stage]);
        await client.query(`insert into stage_history (application_id, stage) values ($1, $2)`, [row.id, stage]);
        await client.query(
          'insert into audit_log (kind, record_id, by_user, detail) values ($1, $2, $3, $4)',
          ['stage_move', row.id, ctx.user!.id, JSON.stringify({ from: current, to: stage })],
        );
        await client.query('commit');
        return current;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    void result;
    const stageNameText = (stage ?? '').charAt(0).toUpperCase() + (stage ?? '').slice(1);
    await outboxInsert(
      ctx.app,
      'stage_change',
      row.contact_email,
      `Your application for ${row.job_title} at ${row.company_name}`,
      `Your application is now at the ${stageNameText} stage.`,
    );
    ctx.app.live.publish({
      type: 'application.stage',
      data: { application_id: row.id, job_id: row.job_id, stage, team: row.company_slug, candidate: null },
    });
    const fresh = await ctx.app.db.one<{
      id: string;
      job_id: string;
      candidate_name: string;
      contact_email: string;
      phone: string;
      cover_note: string;
      stage: string;
      applied_at: Date;
      updated_at: Date;
      resume_file_id: string;
    }>('select * from applications where id = $1', [row.id]);
    sendJson(ctx.res, 200, applicantShape(fresh!, row.job_id));
  }, 'team'),

  route('GET', '/api/employer/jobs/:id/applicants.csv', async (ctx) => {
    const job = await jobFull(ctx, ctx.params.id);
    if (job.company_slug !== ctx.user!.company_slug) throw errors.notFound();
    const rows = await ctx.app.db.many<{
      id: string;
      candidate_name: string;
      stage: string;
      applied_at: Date;
      updated_at: Date;
    }>(
      `select id, candidate_name, stage, applied_at, updated_at from applications
       where job_id = $1 order by applied_at desc, id asc`,
      [job.id],
    );
    const lines: string[] = ['application_id,candidate_name,job_title,stage,applied_on,updated_on'];
    for (const row of rows) {
      const cells = [
        row.id,
        row.candidate_name,
        job.title,
        row.stage,
        isoDate(row.applied_at),
        isoDate(row.updated_at),
      ].map(csvCell);
      lines.push(cells.join(','));
    }
    const csv = lines.join('\r\n');
    ctx.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="applicants-${job.id}.csv"`,
    });
    ctx.res.end(Buffer.from(csv, 'utf8'));
  }, 'team'),

  route('PUT', '/api/employer/company/mark', async (ctx) => {
    const company = await ctx.app.db.one<{ id: string; slug: string; verified: boolean }>(
      'select id, slug, verified from companies where slug = $1',
      [ctx.user!.company_slug],
    );
    if (!company) throw errors.notFound();
    if (!company.verified) throw errors.notVerified();
    if (await tooManyUploads(ctx, 'mark')) throw errors.rateLimited(60);
    const chunks: Buffer[] = [];
    let size = 0;
    const data: Buffer = await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      ctx.req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > 1048576 + 65536) {
          settled = true;
          reject(errors.markTooLarge());
          chunks.length = 0;
          ctx.req.removeAllListeners('data');
          ctx.req.resume();
          return;
        }
        chunks.push(chunk);
      });
      ctx.req.on('end', () => {
        if (!settled) resolve(Buffer.concat(chunks));
      });
      ctx.req.on('error', () => {
        if (!settled) reject(errors.notFound());
      });
    });
    if (data.length > 1048576) throw errors.markTooLarge();
    if (!(data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))) {
      throw errors.markNotPng();
    }
    try {
      await s3.put(`marks/${company.id}.png`, data, { contentType: 'image/png' });
    } catch {
      throw errors.storageUnavailable();
    }
    const fileId = randomId();
    await ctx.app.db.query('delete from files where kind = $1 and company_id = $2', ['mark', company.id]);
    await ctx.app.db.query('insert into files (id, kind, company_id, content_type, size_bytes) values ($1, $2, $3, $4, $5)', [
      fileId,
      'mark',
      company.id,
      'image/png',
      data.length,
    ]);
    await ctx.app.db.query('update companies set mark_file_id = $2 where id = $1', [company.id, fileId]);
    await recordUpload(ctx, 'mark');
    const view = await companyView(ctx.app, company.slug, null);
    ctx.app.live.publish({ type: 'company.changed', data: { slug: company.slug, company: view } });
    sendJson(ctx.res, 200, { mark_url: `/api/files/${fileId}` });
  }, 'team'),
];

// A move is legal one step forward, one step back, or to Declined from any non-declined stage.
export function legalMove(from: string, to: string): boolean {
  if (from === to) return false;
  const order = ['submitted', 'screening', 'interview', 'offer'];
  if (to === 'declined') return from !== 'declined';
  if (from === 'declined') return false;
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  return Math.abs(fromIndex - toIndex) === 1;
}

async function jobFull(ctx: RouteContext, id: string): Promise<JobRow & { company_id: string; company_slug: string }> {
  const row = await ctx.app.db.one<JobRow & { company_id: string }>(
    `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.description, j.status, j.listed_at,
       j.company_id, c.name as company_name, c.slug as company_slug
     from jobs j join companies c on c.id = j.company_id where j.id = $1`,
    [id],
  );
  if (!row) throw errors.notFound();
  return row;
}

interface ApplicantRow {
  id: string;
  job_id: string;
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  stage: string;
  applied_at: Date;
  updated_at: Date;
  resume_file_id: string;
}

function applicantShape(row: ApplicantRow, jobId: string) {
  return {
    id: row.id,
    job_id: jobId,
    candidate_name: row.candidate_name,
    contact_email: row.contact_email,
    phone: row.phone,
    cover_note: row.cover_note,
    stage: row.stage,
    applied_on: isoDate(row.applied_at),
    updated_on: isoDate(row.updated_at),
    resume_file_id: row.resume_file_id,
  };
}

async function applicantRows(ctx: RouteContext, jobId: string) {
  const rows = await ctx.app.db.many<ApplicantRow>(
    `select id, candidate_name, contact_email, phone, cover_note, stage, applied_at, updated_at, resume_file_id
     from applications where job_id = $1 order by applied_at desc, id asc`,
    [jobId],
  );
  return rows.map((row) => applicantShape(row, jobId));
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Minimal multipart reader for the apply form.
interface MultipartResult {
  values: Body;
  files: { [name: string]: { filename: string; data: Buffer } };
}

async function readMultipart(
  ctx: RouteContext,
  boundary: string | null,
  maxBytes: number,
): Promise<MultipartResult> {
  if (!boundary) throw errors.validation({ resume: COPY.resume });
  const chunks: Buffer[] = [];
  let size = 0;
  const data: Buffer = await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    ctx.req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(errors.payloadTooLarge());
        chunks.length = 0;
        ctx.req.removeAllListeners('data');
        ctx.req.resume();
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    ctx.req.on('error', () => {
      if (!settled) reject(errors.notFound());
    });
  });
  const result: MultipartResult = { values: {}, files: {} };
  const delimiter = Buffer.from(`--${boundary}`);
  let position = data.indexOf(delimiter);
  while (position !== -1) {
    const next = data.indexOf(delimiter, position + delimiter.length);
    if (next === -1) break;
    const part = data.subarray(position + delimiter.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const content = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const value = content.subarray(0, content.length - 2);
      if (nameMatch) {
        if (fileMatch) {
          result.files[nameMatch[1]] = { filename: fileMatch[1], data: Buffer.from(value) };
        } else {
          result.values[nameMatch[1]] = value.toString('utf8');
        }
      }
    }
    position = next;
  }
  return result;
}
