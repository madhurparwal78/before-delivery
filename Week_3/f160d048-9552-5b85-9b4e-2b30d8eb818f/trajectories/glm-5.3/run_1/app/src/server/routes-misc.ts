// Channels, the live stream, grading and the founder console.
import type { RouteContext } from './http.js';
import { route, sendJson, type Route } from './http.js';
import { errors } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { randomId, nowMs, now, monthKey } from '../lib/clock.js';
import { AUTHOR_LABEL } from '../lib/reference.js';
import {
  text,
  COPY,
  requireString,
  throwFields,
  type Body,
  type Fields,
} from '../lib/validation.js';
import { migrateAndSeed, seedFounder } from './seed.js';
import { companyView } from './projection.js';
import { syncAllFromPostgres, indexCompany, queueSync } from './search.js';
import { s3 } from '../lib/s3.js';
import { meili } from '../lib/meili.js';
import { smtpAvailable } from '../lib/mail.js';

interface ChannelPostRow {
  id: string;
  channel_slug: string;
  body: string;
  posted_month: string;
}

function quoteFor(body: string): { review_path: string | null } {
  const match = /\/companies\/([a-z0-9-]+)\/reviews\/([a-z0-9-]+)/.exec(body);
  if (!match) return { review_path: null };
  return { review_path: match[0] };
}

async function channelPostShape(
  ctx: RouteContext,
  row: { id: string; channel_slug: string; body: string; posted_month: string },
): Promise<Record<string, unknown>> {
  const { review_path } = quoteFor(row.body);
  let quote: Record<string, unknown> | null = null;
  if (review_path) {
    const [slug, id] = review_path.split('/').slice(-4, -2).length === 2
      ? [review_path.split('/')[2], review_path.split('/')[4]]
      : ['', ''];
    const review = await ctx.app.db.one<{
      id: string;
      title: string;
      pros: string;
      company_slug: string;
      state: string;
    }>(
      `select p.id, p.title, p.pros, p.state, c.slug as company_slug
       from posts p join companies c on c.id = p.company_id
       where p.id = $1 and p.kind = 'review'`,
      [id],
    );
    if (review && review.state === 'approved' && review.company_slug === slug) {
      quote = {
        review_id: review.id,
        company_slug: review.company_slug,
        title: review.title,
        excerpt: review.pros.slice(0, 140),
      };
    } else if (review && (review.state === 'deleted' || review.company_slug !== slug)) {
      quote = { removed: true };
    } else {
      quote = { removed: true };
    }
  }
  return {
    id: row.id,
    channel_slug: row.channel_slug,
    body: row.body,
    posted_month: row.posted_month,
    author_label: AUTHOR_LABEL,
    quote,
  };
}

export const routes: Route[] = [
  // The only config values the browser may receive.
  route('GET', '/api/settings', async (ctx) => {
    sendJson(ctx.res, 200, {
      toast_seconds: config().toastSeconds,
      min_pay_reports: config().minPayReports,
      search_page_size: config().searchPageSize,
    });
  }),

  route('GET', '/api/channels', async (ctx) => {
    const rows = await ctx.app.db.many<{ slug: string; name: string }>('select slug, name from channels order by name asc');
    sendJson(ctx.res, 200, { channels: rows });
  }),

  route('GET', '/api/channels/:slug/posts', async (ctx) => {
    const channel = await ctx.app.db.one<{ id: string; slug: string }>('select id, slug from channels where slug = $1', [
      ctx.params.slug,
    ]);
    if (!channel) throw errors.notFound();
    const rows = await ctx.app.db.many<ChannelPostRow & { channel_slug: string }>(
      `select p.id, p.body, p.posted_month, ch.slug as channel_slug
       from channel_posts p join channels ch on ch.id = p.channel_id
       where ch.slug = $1 order by p.created_at asc`,
      [channel.slug],
    );
    const posts = [];
    for (const row of rows) {
      posts.push(await channelPostShape(ctx, row));
    }
    sendJson(ctx.res, 200, { posts });
  }, 'member'),

  route('POST', '/api/channels/:slug/posts', async (ctx) => {
    const channel = await ctx.app.db.one<{ id: string; slug: string; name: string }>(
      'select id, slug, name from channels where slug = $1',
      [ctx.params.slug],
    );
    if (!channel) throw errors.notFound();
    const b = (ctx.body ?? {}) as Body;
    const fields: Fields = {};
    const bodyText = requireString(b, 'body', 1, 2000, COPY.channel_body, fields);
    throwFields(fields);
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(bodyText)) {
      throw errors.containsEmail('body');
    }
    if (/\+?\d(?:[ .-]?\d){6,}/.test(bodyText.replace(/\/companies\/[a-z0-9-]+\/reviews\/[a-z0-9-]+/gi, ''))) {
      throw errors.containsPhone('body');
    }
    const id = randomId();
    await ctx.app.db.query(
      'insert into channel_posts (id, channel_id, author_id, body, posted_month) values ($1, $2, $3, $4, $5)',
      [id, channel.id, ctx.user!.id, bodyText, monthKey(now())],
    );
    const post = await channelPostShape(ctx, {
      id,
      channel_slug: channel.slug,
      body: bodyText,
      posted_month: monthKey(now()),
    });
    ctx.app.live.publish({ type: 'channel.post', data: { channel_slug: channel.slug, post, channel: channel.slug } });
    sendJson(ctx.res, 201, post);
  }, 'member'),

  // ----- founder -----
  route('GET', '/api/founder/health', async (ctx) => {
    const [searchOk, storageOk, mailOk] = await Promise.all([meili.health(), s3Probe(), smtpAvailable()]);
    const outbox = await ctx.app.db.one<{ n: number }>(
      "select count(*)::int as n from outbox where status <> 'sent'",
    );
    const sync = await ctx.app.db.one<{ n: number }>('select count(*)::int as n from search_sync');
    sendJson(ctx.res, 200, {
      database: 'ok',
      search: searchOk ? 'ok' : 'unavailable',
      storage: storageOk ? 'ok' : 'unavailable',
      mail: mailOk ? 'ok' : 'unavailable',
      outbox_pending: outbox?.n ?? 0,
      search_sync_pending: sync?.n ?? 0,
    });
  }, 'founder'),

  route('GET', '/api/founder/members', async (ctx) => {
    const rows = await ctx.app.db.many<{
      id: string;
      display_name: string;
      email: string;
      role: string;
      company_slug: string | null;
    }>(
      `select u.id, u.display_name, u.email, u.role, c.slug as company_slug
       from users u left join companies c on c.id = u.company_id
       where u.email <> 'seed@candour-bench.test'
       order by u.created_at asc`,
    );
    sendJson(ctx.res, 200, { members: rows });
  }, 'founder'),

  route('POST', '/api/founder/moderators', async (ctx) => {
    const b = (ctx.body ?? {}) as Body;
    const userId = text(b.user_id);
    if (typeof b.user_id !== 'string' || userId.length === 0) {
      throw errors.validation({ user_id: 'Choose a member.' });
    }
    const row = await ctx.app.db.one<{ id: string; display_name: string; email: string; role: string; company_slug: string | null }>(
      `select u.id, u.display_name, u.email, u.role, c.slug as company_slug
       from users u left join companies c on c.id = u.company_id where u.id = $1`,
      [userId],
    );
    if (!row) throw errors.notFound();
    if (row.role !== 'member') throw errors.invalidTransition();
    await ctx.app.db.query("update users set role = 'moderator' where id = $1", [row.id]);
    sendJson(ctx.res, 200, { ...row, role: 'moderator' });
  }, 'founder'),

  route('POST', '/api/founder/companies', async (ctx) => {
    const b = (ctx.body ?? {}) as Body;
    const fields: Fields = {};
    const name = requireString(b, 'name', 2, 120, 'Use 2 to 120 characters.', fields);
    const slug = requireString(b, 'slug', 2, 80, 'Use 2 to 80 characters.', fields);
    const city = requireString(b, 'city', 2, 40, 'Choose a city.', fields);
    const size = requireString(b, 'size', 2, 20, 'Choose a size.', fields);
    const email_domain = requireString(b, 'email_domain', 3, 200, 'Enter an email domain.', fields);
    throwFields(fields);
    const slugTaken = await ctx.app.db.one<{ id: string }>('select id from companies where slug = $1', [slug]);
    if (slugTaken) throw errors.validation({ slug: 'That address is taken.' });
    const nameTaken = await ctx.app.db.one<{ id: string }>('select id from companies where name = $1', [name]);
    if (nameTaken) throw errors.validation({ name: 'That name is taken.' });
    const id = randomId();
    await ctx.app.db.query(
      `insert into companies (id, slug, name, city, size, verified, email_domain) values ($1, $2, $3, $4, $5, false, $6)`,
      [id, slug, name, city, size, email_domain],
    );
    const hit = await ctx.app.db.one<{
      slug: string;
      name: string;
      city: string;
      size: string;
      verified: boolean;
    }>('select slug, name, city, size, verified from companies where id = $1', [id]);
    sendJson(ctx.res, 201, { ...hit, city_name: cityNameOf(hit!.city), rating: null, review_count: 0, pay_report_count: 0 });
  }, 'founder'),

  route('POST', '/api/founder/employer-users', async (ctx) => {
    const b = (ctx.body ?? {}) as Body;
    const fields: Fields = {};
    const companySlug = requireString(b, 'company_slug', 2, 80, 'Choose a company.', fields);
    const displayName = requireString(b, 'display_name', 2, 40, COPY.display_name, fields);
    const email = requireString(b, 'email', 3, 320, COPY.email, fields).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = COPY.email;
    const role = requireString(b, 'role', 2, 40, 'Choose a role.', fields);
    throwFields(fields);
    if (role !== 'recruiter' && role !== 'employer_admin') {
      throw errors.validation({ role: 'Choose a role.' });
    }
    const company = await ctx.app.db.one<{ id: string; slug: string }>('select id, slug from companies where slug = $1', [
      companySlug,
    ]);
    if (!company) throw errors.notFound();
    const taken = await ctx.app.db.one<{ id: string }>('select id from users where email = $1', [email]);
    if (taken) throw errors.validation({ email: 'That address is taken.' });
    const id = randomId();
    const token = randomTokenOf();
    await ctx.app.db.query(
      `insert into users (id, display_name, email, password_hash, role, company_id) values ($1, $2, $3, $4, $5, $6)`,
      [id, displayName, email, 'scrypt$none$none', role, company.id],
    );
    await ctx.app.db.query(
      `insert into tokens (token, kind, email, user_id, expires_at) values ($1, 'set_password', $2, $3, $4)`,
      [token, email, id, new Date(nowMs() + config().emailLinkTtlSeconds * 1000)],
    );
    sendJson(ctx.res, 201, {
      id,
      display_name: displayName,
      email,
      role,
      company_slug: company.slug,
    });
    await insertOutbox(
      ctx,
      'set_password',
      email,
      'Set your Candour Bench password',
      `${config().publicUrl}/reset-password?token=${token}`,
    );
  }, 'founder'),

  route('POST', '/api/founder/companies/:slug/revoke-verification', async (ctx) => {
    const company = await ctx.app.db.one<{ id: string; slug: string; name: string; city: string; size: string; verified: boolean }>(
      'select id, slug, name, city, size, verified from companies where slug = $1',
      [ctx.params.slug],
    );
    if (!company) throw errors.notFound();
    await ctx.app.db.query('update companies set verified = false where id = $1', [company.id]);
    await indexCompany(ctx.app, company.slug).catch(() => undefined);
    const view = await companyView(ctx.app, company.slug, null);
    ctx.app.live.publish({ type: 'company.changed', data: { slug: company.slug, company: view } });
    sendJson(ctx.res, 200, {
      slug: company.slug,
      name: company.name,
      city: company.city,
      city_name: cityNameOf(company.city),
      size: company.size,
      verified: false,
      rating: null,
      review_count: 0,
      pay_report_count: 0,
    });
  }, 'founder'),

  route('GET', '/api/founder/thresholds', async (ctx) => {
    const rows = await ctx.app.db.many<{
      company_slug: string;
      role_family: string;
      city: string;
      report_count: number;
    }>(
      `select c.slug as company_slug, p.role_family, p.city, count(*)::int as report_count
       from posts p join companies c on c.id = p.company_id
       where p.kind = 'pay_report' and p.state = 'approved'
       group by c.slug, c.name, p.role_family, p.city
       order by c.name asc, p.role_family asc, p.city asc`,
    );
    sendJson(ctx.res, 200, {
      rows: rows.map((row) => ({
        company_slug: row.company_slug,
        role_family: row.role_family,
        city: row.city,
        report_count: row.report_count,
        threshold: config().minPayReports,
        shown: row.report_count >= config().minPayReports,
      })),
    });
  }, 'founder'),

  // ----- grading -----
  route('POST', '/api/grading/setup', async (ctx) => {
    if (!gradingAllowed(ctx)) throw errors.notFound();
    const result = await runGradingSetup(ctx);
    sendJson(ctx.res, 201, result);
  }),

  route('POST', '/api/grading/clock', async (ctx) => {
    if (!gradingAllowed(ctx)) throw errors.notFound();
    const b = (ctx.body ?? {}) as Body;
    const seconds = b.advance_seconds;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > 31536000) {
      throw errors.validation({ advance_seconds: 'Choose 0 to 31536000 seconds.' });
    }
    await ctx.app.db.query('update app_clock set clock_offset_ms = clock_offset_ms + $1::bigint where id = 1', [
      seconds * 1000,
    ]);
    await ctx.app.loadClock();
    const { runDueJobs } = await import('./jobs.js');
    await runDueJobs(ctx.app);
    sendJson(ctx.res, 200, { now: new Date(nowMs()).toISOString() });
  }),

  route('POST', '/api/grading/live/close', async (ctx) => {
    if (!gradingAllowed(ctx)) throw errors.notFound();
    const count = ctx.app.live.closeAll();
    sendJson(ctx.res, 200, { closed: count });
  }),
];

function cityNameOf(id: string): string {
  const { CITIES } = require('../lib/reference.js') as typeof import('../lib/reference.js');
  return CITIES.find((c) => c.id === id)?.name ?? id;
}

function randomTokenOf(): string {
  return randomId() + randomId();
}

function gradingAllowed(ctx: RouteContext): boolean {
  const cfg = config();
  if (!cfg.gradingToken) return false;
  const header = String(ctx.req.headers['x-grading-token'] ?? '');
  return header === cfg.gradingToken;
}

async function insertOutbox(ctx: RouteContext, kind: string, to: string, subject: string, body: string): Promise<void> {
  await ctx.app.db.query('insert into outbox (kind, to_email, subject, body) values ($1, $2, $3, $4)', [
    kind,
    to,
    subject,
    body,
  ]);
}

async function s3Probe(): Promise<boolean> {
  try {
    await s3.stat('health/probe');
    return false;
  } catch (err) {
    const message = String(err);
    if (/s3 404/.test(message)) return true;
    return false;
  }
}

// The grading setup writes straight to the records with no moderation, mail or rate limits.
async function runGradingSetup(ctx: RouteContext): Promise<{ ids: Record<string, string>; sessions: Record<string, string> }> {
  const b = (ctx.body ?? {}) as Body;
  const ids: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const client = await ctx.app.db.withClient(async (c) => c);
  const db = ctx.app.db;
  const companyKeys = new Map<string, string>();

  const companies = Array.isArray(b.companies) ? (b.companies as Body[]) : [];
  for (const company of companies) {
    const key = String(company.key ?? '');
    const name = String(company.name ?? '');
    const slug = String(company.slug ?? '');
    const city = String(company.city ?? '');
    const size = String(company.size ?? '11-50');
    const verified = Boolean(company.verified);
    const emailDomain = String(company.email_domain ?? '');
    const existing = await db.one<{ id: string }>('select id from companies where slug = $1 or name = $2', [slug, name]);
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      id = randomId();
      await db.query(
        `insert into companies (id, slug, name, city, size, verified, email_domain) values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, slug, name, city, size, verified, emailDomain],
      );
    }
    ids[key] = id;
    companyKeys.set(key, id);
    if (company.mark === true) {
      const markId = randomId();
      const png = makeMarkPng(name);
      try {
        await s3.put(`marks/${id}.png`, png, { contentType: 'image/png' });
        await db.query('delete from files where kind = $1 and company_id = $2', ['mark', id]);
        await db.query(
          'insert into files (id, kind, company_id, content_type, size_bytes) values ($1, $2, $3, $4, $5)',
          [markId, 'mark', id, 'image/png', png.length],
        );
        await db.query('update companies set mark_file_id = $2 where id = $1', [id, markId]);
      } catch {
        // a storage outage leaves the company without a mark
      }
      ids[`${key}:mark`] = markId;
    }
  }

  const users = Array.isArray(b.users) ? (b.users as Body[]) : [];
  const userKeys = new Map<string, string>();
  for (const user of users) {
    const key = String(user.key ?? '');
    const role = String(user.role ?? 'member');
    const displayName = String(user.display_name ?? '');
    const email = String(user.email ?? '').toLowerCase();
    const password = String(user.password ?? '');
    const companyRef = user.company !== undefined ? String(user.company) : '';
    let companyId: string | null = null;
    if (companyRef) {
      if (companyKeys.has(companyRef)) {
        companyId = companyKeys.get(companyRef)!;
      } else {
        const found = await db.one<{ id: string }>('select id from companies where slug = $1', [companyRef]);
        companyId = found?.id ?? null;
        if (!companyId) throw errors.notFound();
      }
    }
    const unlocked = user.unlocked === true;
    const existing = await db.one<{ id: string }>('select id from users where email = $1', [email]);
    let id: string;
    if (existing) {
      id = existing.id;
      await db.query('update users set role = $2, company_id = $3, unlocked = $4 where id = $1', [
        id,
        role,
        companyId,
        unlocked,
      ]);
    } else {
      id = randomId();
      const { hashPassword } = await import('../lib/clock.js');
      await db.query(
        `insert into users (id, display_name, email, password_hash, role, company_id, unlocked)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, displayName, email, hashPassword(password), role, companyId, unlocked],
      );
    }
    ids[key] = id;
    userKeys.set(key, id);
    const { createSession } = await import('../lib/sessions.js');
    sessions[key] = await createSession(ctx.app, id);
  }

  const resolveCompany = async (ref: string): Promise<string> => {
    if (companyKeys.has(ref)) return companyKeys.get(ref)!;
    const found = await db.one<{ id: string }>('select id from companies where slug = $1', [ref]);
    if (!found) throw errors.notFound();
    return found.id;
  };

  const posts = Array.isArray(b.posts) ? (b.posts as Body[]) : [];
  const postKeys = new Map<string, string>();
  for (const post of posts) {
    const key = String(post.key ?? '');
    const kind = String(post.kind ?? '');
    const company = await resolveCompany(String(post.company ?? ''));
    const authorKey = String(post.author ?? '');
    const author = userKeys.get(authorKey) ?? ids[authorKey];
    if (!author) throw errors.notFound();
    const state = String(post.state ?? 'pending');
    const createdAt = new Date(String(post.created_at ?? new Date().toISOString()));
    const id = randomId();
    const postedMonth = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (kind === 'review') {
      await db.query(
        `insert into posts (id, kind, company_id, author_id, state, title, overall, work_life, pay, management, pros, cons, posted_month, created_at, updated_at, reason)
         values ($1, 'review', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)`,
        [
          id,
          company,
          author,
          state,
          String(post.title ?? ''),
          Number(post.overall ?? 3),
          Number(post.work_life ?? 3),
          Number(post.pay ?? 3),
          Number(post.management ?? 3),
          String(post.pros ?? ''),
          String(post.cons ?? ''),
          postedMonth,
          createdAt,
          post.reason !== undefined ? String(post.reason) : null,
        ],
      );
    } else if (kind === 'pay_report') {
      await db.query(
        `insert into posts (id, kind, company_id, author_id, state, role_family, city, annual_pay, years_experience, posted_month, created_at, updated_at, reason)
         values ($1, 'pay_report', $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)`,
        [
          id,
          company,
          author,
          state,
          String(post.role_family ?? ''),
          String(post.city ?? ''),
          Number(post.annual_pay ?? 0),
          Number(post.years_experience ?? 0),
          postedMonth,
          createdAt,
          post.reason !== undefined ? String(post.reason) : null,
        ],
      );
    } else if (kind === 'interview_note') {
      await db.query(
        `insert into posts (id, kind, company_id, author_id, state, role_family, difficulty, outcome, text_field, posted_month, created_at, updated_at, reason)
         values ($1, 'interview_note', $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)`,
        [
          id,
          company,
          author,
          state,
          String(post.role_family ?? ''),
          Number(post.difficulty ?? 3),
          String(post.outcome ?? 'offer'),
          String(post.text ?? ''),
          postedMonth,
          createdAt,
          post.reason !== undefined ? String(post.reason) : null,
        ],
      );
    } else {
      throw errors.validation({ kind: 'Choose what to share.' });
    }
    if (post.claimed_by !== undefined) {
      const claimedBy = userKeys.get(String(post.claimed_by)) ?? ids[String(post.claimed_by)];
      await db.query(
        `update posts set state = 'claimed', claimed_by = $2, claimed_at = $3, lease_ends_at = $4 where id = $1`,
        [id, claimedBy, createdAt, new Date(createdAt.getTime() + config().claimLapseSeconds * 1000)],
      );
      await db.query(`insert into post_history (post_id, type, by_name, at) values ($1, 'claimed', $2, $3)`, [
        id,
        (await db.one<{ display_name: string }>('select display_name from users where id = $1', [claimedBy]))?.display_name ?? '',
        createdAt,
      ]);
    }
    if (post.decided_by !== undefined) {
      const decidedBy = userKeys.get(String(post.decided_by)) ?? ids[String(post.decided_by)];
      const deciderName =
        (await db.one<{ display_name: string }>('select display_name from users where id = $1', [decidedBy]))?.display_name ?? '';
      await db.query(
        `update posts set state = $2, decided_by = $3, decided_at = $4, reason = $5, claimed_by = $3, claimed_at = $4 where id = $1`,
        [id, state, decidedBy, createdAt, post.reason !== undefined ? String(post.reason) : null],
      );
      await db.query(`insert into post_history (post_id, type, by_name, reason, at) values ($1, $2, $3, $4, $5)`, [
        id,
        state === 'approved' ? 'approved' : 'rejected',
        deciderName,
        post.reason !== undefined ? String(post.reason) : null,
        createdAt,
      ]);
      if (state === 'approved') {
        await db.query('update users set unlocked = true where id = $1 and unlocked = false', [author]);
      }
    }
    ids[key] = id;
    postKeys.set(key, id);
  }

  const replies = Array.isArray(b.replies) ? (b.replies as Body[]) : [];
  for (const reply of replies) {
    const reviewKey = String(reply.review ?? '');
    const reviewId = postKeys.get(reviewKey) ?? ids[reviewKey];
    if (!reviewId) throw errors.notFound();
    const review = await db.one<{ id: string; company_id: string }>('select id, company_id from posts where id = $1', [
      reviewId,
    ]);
    if (!review) throw errors.notFound();
    const postedMonth = new Date().toISOString().slice(0, 7);
    await db.query(
      `insert into replies (review_id, company_id, body, posted_month) values ($1, $2, $3, $4)
       on conflict (review_id) do update set body = excluded.body`,
      [reviewId, review.company_id, String(reply.body ?? ''), postedMonth],
    );
  }

  const jobs = Array.isArray(b.jobs) ? (b.jobs as Body[]) : [];
  for (const job of jobs) {
    const key = String(job.key ?? '');
    const company = await resolveCompany(String(job.company ?? ''));
    const id = randomId();
    const status = String(job.status ?? 'listed');
    const listedAt = job.listed_at !== undefined ? new Date(Number(job.listed_at) * 1000) : new Date();
    await db.query(
      `insert into jobs (id, company_id, title, role_family, city, remote, pay_low, pay_high, description, status, listed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        company,
        String(job.title ?? ''),
        String(job.role_family ?? ''),
        String(job.city ?? ''),
        String(job.remote ?? 'on_site'),
        Number(job.pay_low ?? 0),
        Number(job.pay_high ?? 0),
        String(job.description ?? ''),
        status,
        status === 'listed' ? listedAt : null,
      ],
    );
    ids[key] = id;
  }

  const savedJobs = Array.isArray(b.saved_jobs) ? (b.saved_jobs as Body[]) : [];
  for (const saved of savedJobs) {
    const userKey = String(saved.user ?? '');
    const user = userKeys.get(userKey) ?? ids[userKey];
    const jobKey = String(saved.job ?? '');
    const jobId = ids[jobKey];
    if (!user || !jobId) throw errors.notFound();
    await db.query(`insert into saved_jobs (user_id, job_id) values ($1, $2) on conflict do nothing`, [user, jobId]);
  }

  const alerts = Array.isArray(b.alerts) ? (b.alerts as Body[]) : [];
  for (const alert of alerts) {
    const key = String(alert.key ?? '');
    const userKey = String(alert.user ?? '');
    const user = userKeys.get(userKey) ?? ids[userKey];
    if (!user) throw errors.notFound();
    const id = randomId();
    await db.query(
      'insert into alerts (id, user_id, q, cities, roles, remotes, bands) values ($1, $2, $3, $4, $5, $6, $7)',
      [
        id,
        user,
        String(alert.q ?? ''),
        Array.isArray(alert.city) ? (alert.city as string[]) : [],
        Array.isArray(alert.role) ? (alert.role as string[]) : [],
        Array.isArray(alert.remote) ? (alert.remote as string[]) : [],
        Array.isArray(alert.band) ? (alert.band as string[]) : [],
      ],
    );
    ids[key] = id;
  }

  const applications = Array.isArray(b.applications) ? (b.applications as Body[]) : [];
  for (const application of applications) {
    const key = String(application.key ?? '');
    const jobKey = String(application.job ?? '');
    const jobId = ids[jobKey];
    const userKey = String(application.user ?? '');
    const user = userKeys.get(userKey) ?? ids[userKey];
    if (!jobId || !user) throw errors.notFound();
    const id = randomId();
    const resumeId = randomId();
    const pdf = makeResumePdf();
    try {
      await s3.put(`resumes/${resumeId}.pdf`, pdf, { contentType: 'application/pdf' });
      await db.query('insert into files (id, kind, content_type, size_bytes) values ($1, $2, $3, $4)', [
        resumeId,
        'resume',
        'application/pdf',
        pdf.length,
      ]);
      const appliedAt = application.applied_at !== undefined ? new Date(String(application.applied_at)) : new Date();
      await db.query(
        `insert into applications (id, job_id, user_id, candidate_name, contact_email, phone, cover_note, stage, resume_file_id, applied_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          id,
          jobId,
          user,
          String(application.candidate_name ?? ''),
          String(application.contact_email ?? ''),
          String(application.phone ?? ''),
          String(application.cover_note ?? ''),
          String(application.stage ?? 'submitted'),
          resumeId,
          appliedAt,
        ],
      );
      await db.query(`insert into stage_history (application_id, stage) values ($1, $2)`, [
        id,
        String(application.stage ?? 'submitted'),
      ]);
      ids[key] = id;
      ids[`${key}:resume`] = resumeId;
    } catch {
      // a storage outage skips the application
    }
  }

  const channels = Array.isArray(b.channels) ? (b.channels as Body[]) : [];
  for (const channel of channels) {
    const key = String(channel.key ?? '');
    const slug = String(channel.slug ?? '');
    const existing = await db.one<{ id: string }>('select id from channels where slug = $1', [slug]);
    if (existing) {
      ids[key] = existing.id;
      continue;
    }
    const id = randomId();
    await db.query('insert into channels (id, slug, name) values ($1, $2, $3)', [
      id,
      slug,
      String(channel.name ?? slug),
    ]);
    ids[key] = id;
  }

  const channelPosts = Array.isArray(b.channel_posts) ? (b.channel_posts as Body[]) : [];
  for (const post of channelPosts) {
    const key = String(post.key ?? '');
    const channelRef = String(post.channel ?? '');
    const channel = await db.one<{ id: string; slug: string }>('select id, slug from channels where slug = $1', [
      channelRef,
    ]);
    const channelId = channel?.id ?? ids[channelRef];
    if (!channelId) throw errors.notFound();
    const authorKey = String(post.author ?? '');
    const author = userKeys.get(authorKey) ?? ids[authorKey];
    if (!author) throw errors.notFound();
    const id = randomId();
    const createdAt = post.created_at !== undefined ? new Date(String(post.created_at)) : new Date();
    await db.query(
      'insert into channel_posts (id, channel_id, author_id, body, posted_month, created_at) values ($1, $2, $3, $4, $5, $6)',
      [
        id,
        channelId,
        author,
        String(post.body ?? ''),
        `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`,
        createdAt,
      ],
    );
    ids[key] = id;
  }

  // Index listed jobs and affected companies before answering.
  try {
    await syncAllFromPostgres(ctx.app);
  } catch {
    // an outage leaves the sync queue to retry
  }
  void client;
  return { ids, sessions };
}

// A small generated PDF: header, objects and an xref table.
function makeResumePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Candour Bench resume) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// A small generated PNG: an 8-bit RGBA image with a teal block.
function makeMarkPng(seed: string): Buffer {
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const size = 64;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = rowStart + 1 + x * 4;
      const value = ((x * 7 + y * 13 + hash) % 64) + 32;
      raw[pixel] = 20 + (value % 30);
      raw[pixel + 1] = 90 + ((value >> 1) % 40);
      raw[pixel + 2] = 88 + ((value >> 2) % 30);
      raw[pixel + 3] = 255;
    }
  }
  const crc = crc32(Buffer.from([0x49, 0x45, 0x4e, 0x44]));
  void crc;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: Buffer, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeData = Buffer.concat([type, data]);
    const crcBuffer = crc32Buffer(typeData);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcBuffer >>> 0, 0);
    return Buffer.concat([length, typeData, crc]);
  };
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk(Buffer.from('IHDR'), ihdr),
    chunk(Buffer.from('IDAT'), idat),
    chunk(Buffer.from('IEND'), Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Buffer(buffer: Buffer): number {
  return crc32(buffer);
}
