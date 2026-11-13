// Companies (public projection), member posts and moderation.
import type { RouteContext } from './http.js';
import { route, sendJson, type Route } from './http.js';
import { errors } from '../lib/errors.js';
import { config } from '../lib/config.js';
import { randomId, nowMs, monthKey, now } from '../lib/clock.js';
import {
  CITIES,
  ROLE_FAMILIES,
  POST_KINDS,
  REJECTION_REASONS,
  AUTHOR_LABEL,
  cityName,
  roleName,
} from '../lib/reference.js';
import {
  containsContact,
  text,
  COPY,
  requireString,
  requireInt,
  requireEnum,
  throwFields,
  stripReviewPaths,
  type Body,
  type Fields,
} from '../lib/validation.js';
import { companyView, unlockedFor, type Viewer } from './projection.js';
import { indexCompany } from './search.js';

const CITY_IDS: string[] = CITIES.map((c) => c.id);
const ROLE_IDS: string[] = ROLE_FAMILIES.map((r) => r.id);

export function viewerOf(ctx: RouteContext): Viewer {
  const user = ctx.user;
  if (!user) return { role: 'anonymous', unlocked: false, userId: null };
  return { role: user.role, unlocked: user.unlocked, userId: user.id };
}

export function bodyOf(ctx: RouteContext): Body {
  return (ctx.body ?? {}) as Body;
}

export function postLabel(
  kind: string,
  row: { title?: string | null; role_family?: string | null; company_name: string },
): string {
  if (kind === 'review') return row.title ?? '';
  if (kind === 'pay_report') return `Pay report: ${roleName(row.role_family ?? '')} at ${row.company_name}`;
  return `Interview note: ${roleName(row.role_family ?? '')} at ${row.company_name}`;
}

export async function outboxInsert(
  app: { db: { query: (sql: string, params?: unknown[]) => Promise<unknown> } },
  kind: string,
  to: string,
  subject: string,
  bodyText: string,
): Promise<void> {
  await app.db.query(
    'insert into outbox (kind, to_email, subject, body) values ($1, $2, $3, $4)',
    [kind, to, subject, bodyText],
  );
}

export async function companyOr404(app: { db: { one: <T>(sql: string, params?: unknown[]) => Promise<T | undefined> } }, slug: string) {
  const row = await app.db.one<{
    id: string;
    slug: string;
    name: string;
    city: string;
    size: string;
    verified: boolean;
    email_domain: string;
    mark_file_id: string | null;
  }>('select id, slug, name, city, size, verified, email_domain, mark_file_id from companies where slug = $1', [slug]);
  if (!row) throw errors.notFound();
  return row;
}

// A member's viewer projection: unlocked from the first approval.
export async function maybeUnlock(app: { db: { query: (sql: string, params?: unknown[]) => Promise<unknown> } }, userId: string): Promise<void> {
  await app.db.query(
    `update users set unlocked = true where id = $1 and unlocked = false
     and exists (select 1 from posts where author_id = $1 and state = 'approved')`,
    [userId],
  );
}

export const routes: Route[] = [
  route('GET', '/api/companies/options', async (ctx) => {
    const q = (ctx.url.searchParams.get('q') ?? '').toLowerCase();
    const rows = await ctx.app.db.many<{ id: string; name: string; city: string }>(
      'select id, name, city from companies order by name asc',
    );
    const options = rows
      .filter((row) => row.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((row) => ({ id: row.id, name: row.name, city: row.city }));
    sendJson(ctx.res, 200, { options });
  }),

  route('GET', '/api/companies/search', async (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const city = ctx.url.searchParams.get('city') ?? '';
    const page = Math.max(1, Number.parseInt(ctx.url.searchParams.get('page') ?? '1', 10) || 1);
    const size = config().searchPageSize;
    try {
      const result = await (await import('../lib/meili.js')).meili.search('companies', {
        q,
        limit: size,
        offset: (page - 1) * size,
        facets: ['city'],
        filter: city ? `city = "${city}"` : undefined,
      });
      const hits = (result.hits as unknown as Record<string, unknown>[]) ?? [];
      sendJson(ctx.res, 200, {
        total: result.estimatedTotalHits ?? hits.length,
        page,
        page_size: size,
        hits: hits.map((hit) => ({
          slug: hit.slug,
          name: hit.name,
          city: hit.city,
          city_name: hit.city_name,
          size: hit.size,
          verified: hit.verified,
          rating: hit.rating,
          review_count: hit.review_count,
          pay_report_count: hit.pay_report_count,
        })),
        facets: { city: (result.facetDistribution?.city as Record<string, number>) ?? {} },
      });
    } catch {
      // Fallback from PostgreSQL: every company, cities in alphabetical order.
      const companies = await ctx.app.db.many<{
        slug: string;
        name: string;
        city: string;
        city_name: string;
        size: string;
        verified: boolean;
        rating: number | null;
        review_count: number;
        pay_report_count: number;
      }>(
        `select c.slug, c.name, c.city, c.size, c.verified,
          (select round(avg(p.overall)::numeric, 1)::float8 from posts p where p.company_id = c.id and p.kind = 'review' and p.state = 'approved') as rating,
          (select count(*)::int from posts p where p.company_id = c.id and p.kind = 'review' and p.state = 'approved') as review_count,
          (select count(*)::int from posts p where p.company_id = c.id and p.kind = 'pay_report' and p.state = 'approved') as pay_report_count
         from companies c order by c.name asc`,
      );
      const cities = new Map<string, { city: string; city_name: string; total: number; companies: unknown[] }>();
      for (const company of companies) {
        const entry = cities.get(company.city) ?? {
          city: company.city,
          city_name: cityName(company.city),
          total: 0,
          companies: [] as unknown[],
        };
        entry.companies.push({
          slug: company.slug,
          name: company.name,
          city: company.city,
          city_name: cityName(company.city),
          size: company.size,
          verified: company.verified,
          rating: company.rating,
          review_count: company.review_count,
          pay_report_count: company.pay_report_count,
        });
        entry.total += 1;
        cities.set(company.city, entry);
      }
      const cityList = [...cities.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, value]) => ({ ...value, city: id }));
      sendJson(ctx.res, 200, { fallback: 'by_city', cities: cityList });
    }
  }),

  route('GET', '/api/companies/:slug', async (ctx) => {
    const view = await companyView(ctx.app, ctx.params.slug, viewerOf(ctx));
    if (!view) throw errors.notFound();
    sendJson(ctx.res, 200, view);
  }),

  route('GET', '/api/companies/:slug/reviews/:id', async (ctx) => {
    const row = await ctx.app.db.one<{
      id: string;
      company_id: string;
      title: string;
      overall: number;
      work_life: number;
      pay: number;
      management: number;
      pros: string;
      cons: string;
      posted_month: string;
    }>(
      `select id, company_id, title, overall, work_life, pay, management, pros, cons, posted_month
       from posts where id = $1 and kind = 'review' and state = 'approved'`,
      [ctx.params.id],
    );
    if (!row) throw errors.notFound();
    const company = await ctx.app.db.one<{ slug: string; name: string }>(
      'select slug, name from companies where id = $1',
      [row.company_id],
    );
    if (!company || company.slug !== ctx.params.slug) throw errors.notFound();
    const viewer = viewerOf(ctx);
    const unlocked = unlockedFor(viewer);
    const cut = (value: string) => {
      if (unlocked) return { text: value, truncated: false };
      if (value.length <= 140) return { text: value, truncated: false };
      return { text: value.slice(0, 140), truncated: true };
    };
    const pros = cut(row.pros);
    const cons = cut(row.cons);
    const reply = await ctx.app.db.one<{ body: string; posted_month: string; company_name: string }>(
      `select r.body, r.posted_month, c.name as company_name
       from replies r join companies c on c.id = r.company_id where r.review_id = $1`,
      [row.id],
    );
    sendJson(ctx.res, 200, {
      id: row.id,
      title: row.title,
      overall: row.overall,
      work_life: row.work_life,
      pay: row.pay,
      management: row.management,
      pros: pros.text + (pros.truncated ? '…' : ''),
      cons: cons.text + (cons.truncated ? '…' : ''),
      truncated: pros.truncated || cons.truncated,
      posted_month: row.posted_month,
      author_label: AUTHOR_LABEL,
      reply: reply ? { company_name: reply.company_name, body: reply.body, posted_month: reply.posted_month } : null,
    });
  }),

  // ----- member posts -----

  route(
    'POST',
    '/api/posts',
    async (ctx) => {
      const b = bodyOf(ctx);
      const fields: Fields = {};
      const kind = requireEnum(b, 'kind', POST_KINDS, 'Choose what to share.', fields);
      if (!kind) throwFields(fields);
      const companyId = text(b.company_id);
      if (typeof b.company_id !== 'string' || companyId.length === 0) {
        fields.company_id = COPY.company_id;
        throwFields(fields);
      }
      const company = await ctx.app.db.one<{ id: string; slug: string; name: string }>(
        'select id, slug, name from companies where id = $1',
        [companyId],
      );
      if (!company) throw errors.notFound();

      if (kind === 'review') {
        const overall = requireInt(b, 'overall', 1, 5, COPY.rating, fields);
        const work_life = requireInt(b, 'work_life', 1, 5, COPY.rating, fields);
        const pay = requireInt(b, 'pay', 1, 5, COPY.rating, fields);
        const management = requireInt(b, 'management', 1, 5, COPY.rating, fields);
        const title = requireString(b, 'title', 5, 120, COPY.title_review, fields);
        const pros = requireString(b, 'pros', 20, 3000, COPY.body, fields);
        const cons = requireString(b, 'cons', 20, 3000, COPY.body, fields);
        throwFields(fields);
        throwIfContact({ title, pros, cons });
        const since = new Date(nowMs() - 365 * 24 * 3600 * 1000);
        const existing = await ctx.app.db.one<{ n: number }>(
          `select count(*)::int as n from posts
           where author_id = $1 and company_id = $2 and kind = 'review' and created_at > $3`,
          [ctx.user!.id, company.id, since],
        );
        if ((existing?.n ?? 0) >= config().reviewsPerCompanyPerYear) {
          throw errors.duplicateReview();
        }
        const id = randomId();
        await ctx.app.db.query(
          `insert into posts (id, kind, company_id, author_id, state, title, overall, work_life, pay, management, pros, cons, posted_month, created_at, updated_at)
           values ($1, 'review', $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, now(), now())`,
          [id, company.id, ctx.user!.id, title, overall, work_life, pay, management, pros, cons, monthKey(now())],
        );
        await publishPostCreated(ctx, id, kind, company.name, title);
        return;
      }

      if (kind === 'pay_report') {
        const role_family = requireEnum(b, 'role_family', ROLE_IDS as unknown as string[], COPY.role_family, fields);
        const city = requireEnum(b, 'city', CITY_IDS as unknown as string[], COPY.city, fields);
        const annual_pay = requireInt(b, 'annual_pay', 100000, 5000000, COPY.pay, fields);
        const years_experience = requireInt(b, 'years_experience', 0, 40, COPY.years, fields);
        throwFields(fields);
        const id = randomId();
        await ctx.app.db.query(
          `insert into posts (id, kind, company_id, author_id, state, role_family, city, annual_pay, years_experience, posted_month, created_at, updated_at)
           values ($1, 'pay_report', $2, $3, 'pending', $4, $5, $6, $7, $8, now(), now())`,
          [id, company.id, ctx.user!.id, role_family, city, annual_pay, years_experience, monthKey(now())],
        );
        await publishPostCreated(ctx, id, kind, company.name, `Pay report: ${roleName(role_family!)} at ${company.name}`);
        return;
      }

      const role_family = requireEnum(b, 'role_family', ROLE_IDS as unknown as string[], COPY.role_family, fields);
      const difficulty = requireInt(b, 'difficulty', 1, 5, COPY.rating, fields);
      const outcome = requireEnum(b, 'outcome', ['offer', 'no_offer', 'no_reply'], COPY.outcome, fields);
      const noteText = requireString(b, 'text', 20, 3000, COPY.body, fields);
      throwFields(fields);
      throwIfContact({ text: noteText });
      const id = randomId();
      await ctx.app.db.query(
        `insert into posts (id, kind, company_id, author_id, state, role_family, difficulty, outcome, text_field, posted_month, created_at, updated_at)
         values ($1, 'interview_note', $2, $3, 'pending', $4, $5, $6, $7, $8, now(), now())`,
        [id, company.id, ctx.user!.id, role_family, difficulty, outcome, noteText, monthKey(now())],
      );
      await publishPostCreated(ctx, id, kind!, company.name, `Interview note: ${roleName(role_family!)} at ${company.name}`);
    },
    'member',
  ),

  route('GET', '/api/me/posts', async (ctx) => {
    const rows = await ctx.app.db.many<{
      id: string;
      kind: string;
      state: string;
      reason: string | null;
      posted_month: string;
      title: string | null;
      role_family: string | null;
      company_name: string;
      created_at: Date;
      claimed_by: string | null;
    }>(
      `select p.id, p.kind, p.state, p.reason, p.posted_month, p.title, p.role_family, p.created_at, p.claimed_by,
        c.name as company_name
       from posts p join companies c on c.id = p.company_id
       where p.author_id = $1 and p.state <> 'deleted'
       order by p.created_at desc`,
      [ctx.user!.id],
    );
    const editLimitMs = config().editWindowMinutes * 60 * 1000;
    const moderatorIds = await ctx.app.db.many<{ id: string }>(
      "select id from users where role in ('moderator','founder')",
    );
    const moderatorSet = new Set(moderatorIds.map((row) => row.id));
    const nameRows = await ctx.app.db.many<{ id: string; display_name: string }>(
      'select id, display_name from users',
    );
    const names = new Map(nameRows.map((row) => [row.id, row.display_name]));
    sendJson(ctx.res, 200, {
      posts: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: postLabel(row.kind, { title: row.title, role_family: row.role_family, company_name: row.company_name }),
        company_name: row.company_name,
        state: row.state,
        reason: row.reason,
        posted_month: row.posted_month,
        editable:
          (row.state === 'pending' || row.state === 'approved') &&
          nowMs() - row.created_at.getTime() < editLimitMs,
      })),
    });
  }),

  route(
    'PATCH',
    '/api/posts/:id',
    async (ctx) => {
      const row = await ctx.app.db.one<{
        id: string;
        kind: string;
        company_id: string;
        author_id: string;
        state: string;
        claimed_by: string | null;
        created_at: Date;
      }>('select id, kind, company_id, author_id, state, claimed_by, created_at from posts where id = $1', [
        ctx.params.id,
      ]);
      if (!row || row.author_id !== ctx.user!.id || row.state === 'deleted' || row.state === 'rejected') {
        throw errors.notFound();
      }
      if (row.state === 'claimed') throw errors.inReview();
      if (nowMs() - row.created_at.getTime() >= config().editWindowMinutes * 60 * 1000) {
        throw errors.editWindowClosed();
      }
      const b = bodyOf(ctx);
      const fields: Fields = {};
      if (row.kind === 'review') {
        const title = requireString(b, 'title', 5, 120, COPY.title_review, fields);
        const pros = requireString(b, 'pros', 20, 3000, COPY.body, fields);
        const cons = requireString(b, 'cons', 20, 3000, COPY.body, fields);
        requireInt(b, 'overall', 1, 5, COPY.rating, fields);
        requireInt(b, 'work_life', 1, 5, COPY.rating, fields);
        requireInt(b, 'pay', 1, 5, COPY.rating, fields);
        requireInt(b, 'management', 1, 5, COPY.rating, fields);
        throwFields(fields);
        throwIfContact({ title, pros, cons });
        await ctx.app.db.query(
          `update posts set title = $2, pros = $3, cons = $4, overall = $5, work_life = $6, pay = $7, management = $8,
           state = 'pending', reason = null, decided_by = null, decided_at = null, updated_at = now()
           where id = $1`,
          [
            row.id,
            title,
            pros,
            cons,
            (b.overall as number) ?? null,
            (b.work_life as number) ?? null,
            (b.pay as number) ?? null,
            (b.management as number) ?? null,
          ],
        );
      } else if (row.kind === 'pay_report') {
        const role_family = requireEnum(b, 'role_family', ROLE_IDS as unknown as string[], COPY.role_family, fields);
        const city = requireEnum(b, 'city', CITY_IDS as unknown as string[], COPY.city, fields);
        const annual_pay = requireInt(b, 'annual_pay', 100000, 5000000, COPY.pay, fields);
        requireInt(b, 'years_experience', 0, 40, COPY.years, fields);
        throwFields(fields);
        await ctx.app.db.query(
          `update posts set role_family = $2, city = $3, annual_pay = $4, years_experience = $5,
           state = 'pending', reason = null, decided_by = null, decided_at = null, updated_at = now()
           where id = $1`,
          [row.id, role_family, city, annual_pay, (b.years_experience as number) ?? 0],
        );
      } else {
        const role_family = requireEnum(b, 'role_family', ROLE_IDS as unknown as string[], COPY.role_family, fields);
        requireInt(b, 'difficulty', 1, 5, COPY.rating, fields);
        requireEnum(b, 'outcome', ['offer', 'no_offer', 'no_reply'], COPY.outcome, fields);
        const noteText = requireString(b, 'text', 20, 3000, COPY.body, fields);
        throwFields(fields);
        throwIfContact({ text: noteText });
        await ctx.app.db.query(
          `update posts set role_family = $2, difficulty = $3, outcome = $4, text_field = $5,
           state = 'pending', reason = null, decided_by = null, decided_at = null, updated_at = now()
           where id = $1`,
          [row.id, role_family, (b.difficulty as number) ?? null, b.outcome as string, noteText],
        );
      }
      const company = await ctx.app.db.one<{ slug: string; name: string }>(
        'select slug, name from companies where id = $1',
        [row.company_id],
      );
      const label =
        row.kind === 'review'
          ? ((b.title as string) ?? '')
          : `${row.kind === 'pay_report' ? 'Pay report' : 'Interview note'}: ${roleName(
              (b.role_family as string) ?? '',
            )} at ${company?.name ?? ''}`;
      await ctx.app.db.query('delete from replies where review_id = $1', [row.id]).catch(() => undefined);
      await indexCompany(ctx.app, company!.slug).catch(() => undefined);
      sendJson(ctx.res, 200, {
        id: row.id,
        kind: row.kind,
        state: 'pending',
        label,
        company_name: company?.name ?? '',
        posted_month: monthKey(now()),
      });
    },
    'member',
  ),

  route(
    'DELETE',
    '/api/posts/:id',
    async (ctx) => {
      const row = await ctx.app.db.one<{ id: string; state: string; company_id: string }>(
        'select id, state, company_id from posts where id = $1 and author_id = $2',
        [ctx.params.id, ctx.user!.id],
      );
      if (!row || row.state === 'deleted') throw errors.notFound();
      if (row.state === 'claimed') throw errors.inReview();
      await ctx.app.db.query("update posts set state = 'deleted', updated_at = now() where id = $1", [row.id]);
      const company = await ctx.app.db.one<{ slug: string }>('select slug from companies where id = $1', [row.company_id]);
      if (company) {
        await indexCompany(ctx.app, company.slug).catch(() => undefined);
        const view = await companyView(ctx.app, company.slug, null);
        ctx.app.live.publish({ type: 'company.changed', data: { slug: company.slug, company: view } });
      }
      ctx.res.writeHead(204);
      ctx.res.end();
    },
    'member',
  ),

  // ----- moderation -----

  route('GET', '/api/moderation/queue', async (ctx) => {
    const rows = await ctx.app.db.many<{
      id: string;
      kind: string;
      state: string;
      claimed_by: string | null;
      title: string | null;
      role_family: string | null;
      company_name: string;
      posted_month: string;
      overall: number | null;
      work_life: number | null;
      pay: number | null;
      management: number | null;
      pros: string | null;
      cons: string | null;
      city: string | null;
      annual_pay: number | null;
      years_experience: number | null;
      difficulty: number | null;
      outcome: string | null;
      text_field: string | null;
      created_at: Date;
      lease_ends_at: Date | null;
    }>(
      `select p.*, c.name as company_name from posts p join companies c on c.id = p.company_id
       where p.state in ('pending','claimed') order by p.created_at asc`,
    );
    const claimantRows = await ctx.app.db.many<{ id: string; display_name: string }>(
      'select id, display_name from users',
    );
    const names = new Map(claimantRows.map((r) => [r.id, r.display_name]));
    const visible = rows.filter((row) => row.claimed_by !== ctx.user!.id || row.state === 'claimed');
    sendJson(ctx.res, 200, {
      posts: visible.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: postLabel(row.kind, { title: row.title, role_family: row.role_family, company_name: row.company_name }),
        company_name: row.company_name,
        posted_month: row.posted_month,
        state: row.state,
        claimed_by_name: row.claimed_by ? names.get(row.claimed_by) ?? null : null,
        claimed_by_you: row.claimed_by === ctx.user!.id,
        overall: row.overall,
        work_life: row.work_life,
        pay: row.pay,
        management: row.management,
        pros: row.pros,
        cons: row.cons,
        role_family: row.role_family,
        city: row.city,
        annual_pay: row.annual_pay,
        years_experience: row.years_experience,
        difficulty: row.difficulty,
        outcome: row.outcome,
        text: row.text_field,
      })),
    });
  }, 'moderator'),

  route('POST', '/api/moderation/:id/claim', async (ctx) => {
    const moderatorId = ctx.user!.id;
    const result = await ctx.app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const found = await client.query(
          'select id, state, claimed_by, author_id, company_id, decided_by from posts where id = $1 for update',
          [ctx.params.id],
        );
        if (found.rows.length === 0) {
          await client.query('rollback');
          throw errors.notFound();
        }
        const post = found.rows[0] as {
          id: string;
          state: string;
          claimed_by: string | null;
          author_id: string;
          company_id: string;
          decided_by: string | null;
        };
        if (post.author_id === moderatorId) {
          await client.query('rollback');
          throw errors.notFound();
        }
        if (post.state === 'approved' || post.state === 'rejected' || post.state === 'deleted') {
          const deciderName = post.decided_by ? (await client.query('select display_name from users where id = $1', [post.decided_by])).rows[0]?.display_name : null;
          await client.query('rollback');
          throw errors.alreadyDecided(deciderName ?? 'a moderator', post.state as 'approved' | 'rejected');
        }
        if (post.state === 'claimed') {
          const claimantName = post.claimed_by
            ? (await client.query('select display_name from users where id = $1', [post.claimed_by])).rows[0]?.display_name
            : null;
          await client.query('rollback');
          if (post.claimed_by === moderatorId) {
            // A re-claim of one's own claim answers 200 and leaves the claim time unchanged.
            return { id: post.id, state: 'claimed', claimed_by_name: claimantName ?? '', self: true, author: post.author_id };
          }
          throw errors.alreadyClaimed(claimantName ?? 'a moderator');
        }
        const leaseEnds = new Date(nowMs() + config().claimLapseSeconds * 1000);
        await client.query(
          `update posts set state = 'claimed', claimed_by = $2, last_claimant = null, claimed_at = now(), lease_ends_at = $3 where id = $1`,
          [post.id, moderatorId, leaseEnds],
        );
        await client.query(
          `insert into post_history (post_id, type, by_name) values ($1, 'claimed', $2)`,
          [post.id, ctx.user!.display_name],
        );
        await client.query('commit');
        return { id: post.id, state: 'claimed', claimed_by_name: ctx.user!.display_name, self: false, author: post.author_id };
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    if (!result.self) {
      ctx.app.live.publish({
        type: 'queue.changed',
        data: { post_id: result.id, state: 'claimed', by_name: ctx.user!.display_name },
      });
      ctx.app.live.publish({
        type: 'queue.history',
        data: {
          post_id: result.id,
          event: { type: 'claimed', by_name: ctx.user!.display_name, reason: null, at: new Date().toISOString() },
        },
      });
      ctx.app.live.publish({
        type: 'post.state',
        data: { post_id: result.id, state: 'claimed', reason: null, author: result.author },
      });
    }
    sendJson(ctx.res, 200, { id: result.id, state: 'claimed', claimed_by_name: result.claimed_by_name });
  }, 'moderator'),

  route('POST', '/api/moderation/:id/renew', async (ctx) => {
    const moderatorId = ctx.user!.id;
    const result = await ctx.app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const found = await client.query(
          'select id, state, claimed_by, last_claimant, lease_ends_at, author_id from posts where id = $1 for update',
          [ctx.params.id],
        );
        if (found.rows.length === 0) {
          await client.query('rollback');
          throw errors.notFound();
        }
        const post = found.rows[0] as { id: string; state: string; claimed_by: string | null; last_claimant: string | null; lease_ends_at: Date | null; author_id: string };
        if (post.state === 'approved' || post.state === 'rejected') {
          await client.query('rollback');
          throw errors.notFound();
        }
        if (post.state === 'claimed') {
          if (post.claimed_by !== moderatorId) {
            const claimantName = post.claimed_by
              ? (await client.query('select display_name from users where id = $1', [post.claimed_by])).rows[0]?.display_name
              : null;
            await client.query('rollback');
            throw errors.alreadyClaimed(claimantName ?? 'a moderator');
          }
          const leaseEnds = new Date(nowMs() + config().claimLapseSeconds * 1000);
          await client.query('update posts set lease_ends_at = $2 where id = $1', [post.id, leaseEnds]);
          await client.query(
            `insert into post_history (post_id, type, by_name) values ($1, 'renewed', $2)`,
            [post.id, ctx.user!.display_name],
          );
          await client.query('commit');
          return { id: post.id, lease_ends_at: leaseEnds.toISOString(), renewed: true };
        }
        await client.query('rollback');
        if (post.last_claimant === moderatorId) throw errors.claimExpired();
        throw errors.notClaimed();
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    if (result.renewed) {
      ctx.app.live.publish({
        type: 'queue.history',
        data: {
          post_id: result.id,
          event: { type: 'renewed', by_name: ctx.user!.display_name, reason: null, at: new Date().toISOString() },
        },
      });
      sendJson(ctx.res, 200, { id: result.id, state: 'claimed', lease_ends_at: result.lease_ends_at });
      return;
    }
    sendJson(ctx.res, 200, { id: result.id, state: 'claimed', lease_ends_at: result.lease_ends_at });
  }, 'moderator'),

  route('GET', '/api/moderation/:id/history', async (ctx) => {
    const rows = await ctx.app.db.many<{ type: string; by_name: string | null; reason: string | null; at: Date }>(
      'select type, by_name, reason, at from post_history where post_id = $1 order by id asc',
      [ctx.params.id],
    );
    sendJson(ctx.res, 200, {
      events: rows.map((row) => ({
        type: row.type,
        by_name: row.by_name,
        reason: row.reason,
        at: row.at.toISOString(),
      })),
    });
  }, 'moderator'),

  route('POST', '/api/moderation/:id/decision', async (ctx) => {
    const moderatorId = ctx.user!.id;
    const b = bodyOf(ctx);
    const fields: Fields = {};
    const decision = requireEnum(b, 'decision', ['approve', 'reject'], 'Choose a decision.', fields);
    let reason: string | null = null;
    let details: string | null = null;
    if (decision === 'reject') {
      reason = requireEnum(b, 'reason', REJECTION_REASONS, COPY.reason, fields);
      if (reason === 'Other') {
        details = requireString(b, 'details', 5, 200, COPY.details, fields);
      }
      throwFields(fields);
    } else {
      throwFields(fields);
    }
    const outcome = await ctx.app.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const found = await client.query(
          'select id, state, claimed_by, last_claimant, claimed_at, author_id, company_id, kind, title, role_family from posts where id = $1 for update',
          [ctx.params.id],
        );
        if (found.rows.length === 0) {
          await client.query('rollback');
          throw errors.notFound();
        }
        const post = found.rows[0] as {
          id: string;
          state: string;
          claimed_by: string | null;
          last_claimant: string | null;
          author_id: string;
          company_id: string;
          kind: string;
          title: string | null;
          role_family: string | null;
        };
        const authorRow = await client.query('select id, email from users where id = $1', [post.author_id]);
        if (authorRow.rows.length === 0 || post.author_id === moderatorId) {
          await client.query('rollback');
          throw errors.notFound();
        }
        if (post.state === 'approved' || post.state === 'rejected' || post.state === 'deleted') {
          await client.query('rollback');
          throw errors.notFound();
        }
        if (post.state === 'pending') {
          await client.query('rollback');
          if (post.last_claimant === moderatorId) throw errors.claimExpired();
          throw errors.notClaimed();
        }
        if (post.claimed_by !== moderatorId) {
          const claimantName = post.claimed_by
            ? (await client.query('select display_name from users where id = $1', [post.claimed_by])).rows[0]?.display_name
            : null;
          await client.query('rollback');
          throw errors.alreadyClaimed(claimantName ?? 'a moderator');
        }
        const newState = decision === 'approve' ? 'approved' : 'rejected';
        await client.query(
          `update posts set state = $2, decided_by = $3, decided_at = now(), reason = $4, lease_ends_at = null, last_claimant = null where id = $1`,
          [post.id, newState, moderatorId, decision === 'reject' ? (reason === 'Other' ? details : reason) : null],
        );
        await client.query(
          `insert into post_history (post_id, type, by_name, reason) values ($1, $2, $3, $4)`,
          [post.id, newState, ctx.user!.display_name, decision === 'reject' ? (reason === 'Other' ? details : reason) : null],
        );
        if (newState === 'approved') {
          await client.query('update users set unlocked = true where id = $1 and unlocked = false', [post.author_id]);
        }
        const company = (await client.query('select slug, name from companies where id = $1', [post.company_id]))
          .rows[0] as { slug: string; name: string };
        await client.query('commit');
        return { post, newState, company, authorEmail: (authorRow.rows[0] as { email: string }).email, authorId: post.author_id };
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      }
    });
    if (outcome.newState === 'approved') {
      await indexCompany(ctx.app, outcome.company.slug).catch(() => undefined);
    }
    const label = postLabel(outcome.post.kind, {
      title: outcome.post.title,
      role_family: outcome.post.role_family,
      company_name: outcome.company.name,
    });
    const kindText = outcome.post.kind === 'pay_report' ? 'pay report' : outcome.post.kind === 'interview_note' ? 'interview note' : 'review';
    const reasonText = decision === 'reject' ? (reason === 'Other' ? details : reason) : null;
    await outboxInsert(
      ctx.app,
      'moderation_outcome',
      outcome.authorEmail,
      `Your post on Candour Bench was ${decision === 'approve' ? 'approved' : 'rejected'}`,
      `Your ${kindText} for ${outcome.company.name} was ${decision === 'approve' ? 'approved' : 'rejected'}.` +
        (reasonText ? `\nReason: ${reasonText}.` : ''),
    );
    ctx.app.live.publish({
      type: 'queue.changed',
      data: { post_id: outcome.post.id, state: outcome.newState, by_name: ctx.user!.display_name },
    });
    ctx.app.live.publish({
      type: 'queue.history',
      data: {
        post_id: outcome.post.id,
        event: {
          type: outcome.newState,
          by_name: ctx.user!.display_name,
          reason: reasonText,
          at: new Date().toISOString(),
        },
      },
    });
    ctx.app.live.publish({
      type: 'post.state',
      data: { post_id: outcome.post.id, state: outcome.newState, reason: reasonText, author: outcome.authorId },
    });
    if (outcome.newState === 'approved') {
      const freshAuthor = await ctx.app.db.one<{ unlocked: boolean }>('select unlocked from users where id = $1', [
        outcome.authorId,
      ]);
      if (freshAuthor?.unlocked) {
        ctx.app.live.publish({ type: 'member.unlocked', data: { member: outcome.authorId } });
      }
      const view = await companyView(ctx.app, outcome.company.slug, null);
      ctx.app.live.publish({ type: 'company.changed', data: { slug: outcome.company.slug, company: view } });
    }
    sendJson(ctx.res, 200, { id: outcome.post.id, state: outcome.newState, decided_by_name: ctx.user!.display_name });
  }, 'moderator'),
];


async function publishPostCreated(
  ctx: RouteContext,
  id: string,
  kind: string,
  companyName: string,
  label: string,
): Promise<void> {
  sendJson(ctx.res, 201, {
    id,
    kind,
    state: 'pending',
    label,
    company_name: companyName,
    posted_month: monthKey(now()),
  });
}

// Contact-detail checks, in field order, email first.
function throwIfContact(values: Record<string, string>): void {
  for (const [field, value] of Object.entries(values)) {
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(stripReviewPaths(value))) {
      throw errors.containsEmail(field);
    }
  }
  for (const [field, value] of Object.entries(values)) {
    if (/\+?\d(?:[ .-]?\d){6,}/.test(stripReviewPaths(value))) {
      throw errors.containsPhone(field);
    }
  }
}