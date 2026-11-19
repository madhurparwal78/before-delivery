import { randomUUID } from 'node:crypto';
import { blockedWith, degreeBetween, type Degree } from '../../domain/graph';
import { jobCard, jobOpen, JOB_COLUMNS, type JobRow } from '../../domain/jobs';
import { personCard, type MemberRow } from '../../domain/members';
import { markNotificationsSeen, notificationsFor } from '../../domain/notifications';
import { POST_COLUMNS, postObject, postVisibleTo, type PostRow } from '../../domain/posts';
import { businessNow, businessNowIso } from '../clock';
import { config } from '../config';
import { query } from '../db';
import { validation } from '../errors';
import { requireMember, sendJson, type Ctx } from '../http';
import { addClient, removeClient } from '../live';
import { storageReachable } from '../storage';

export async function health(ctx: Ctx): Promise<void> {
  const ok = await storageReachable();
  sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
}

export function configEndpoint(ctx: Ctx): void {
  sendJson(ctx.res, 200, {
    post_max_chars: config.postMaxChars,
    see_more_chars: config.seeMoreChars,
    typing_timeout_ms: config.typingTimeoutMs,
    max_skills: config.maxSkills,
    photo_max_bytes: config.photoMaxBytes,
    resume_max_bytes: config.resumeMaxBytes,
    feed_page_size: config.feedPageSize,
    time_zone: config.timeZone,
    now: businessNowIso(),
  });
}

export function liveStream(ctx: Ctx): void {
  const memberId = requireMember(ctx);
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const id = randomUUID();
  addClient(id, memberId, ctx.res);
  ctx.res.write(`event: hello\ndata: ${JSON.stringify({ now: businessNowIso() })}\n\n`);
  ctx.req.on('close', () => removeClient(id));
}

export async function getNotifications(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  return { status: 200, body: await notificationsFor(memberId) };
}

export async function seenNotifications(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  await markNotificationsSeen(memberId);
  return { status: 200, body: { unread_count: 0 } };
}

/** Every query word must be a word prefix of the target. */
function matchesQuery(words: string[], targets: string[]): boolean {
  const haystack = targets
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
  return words.every((word) => haystack.some((candidate) => candidate.startsWith(word)));
}

const DEGREE_RANK: Record<Degree, number> = { '1': 0, '2': 1, '3': 2, out: 3 };

async function searchPeople(
  viewerId: string,
  words: string[],
  ctx: Ctx,
): Promise<Record<string, unknown>[]> {
  if (words.length === 0) return [];
  const excluded = await blockedWith(viewerId);
  const degreeFilterRaw = ctx.search.get('degree');
  const degreeFilter =
    degreeFilterRaw === null || degreeFilterRaw === '' || degreeFilterRaw === '1,2,3'
      ? null
      : new Set(degreeFilterRaw.split(',').map((value) => value.trim()));
  const companyFilter = (ctx.search.get('company') ?? '').trim().toLowerCase();
  const locationFilter = (ctx.search.get('location') ?? '').trim().toLowerCase();

  const rows = await query<MemberRow>(
    `SELECT id, email, handle, name, headline, location, about, visibility, photo_id, versions
     FROM members WHERE confirmed = true AND id <> $1`,
    [viewerId],
  );
  const matched: { card: Record<string, unknown>; degree: Degree; name: string; id: string }[] = [];
  for (const member of rows) {
    if (excluded.has(member.id)) continue;
    if (!matchesQuery(words, [member.name, member.headline])) continue;
    const degree = await degreeBetween(viewerId, member.id);
    if (member.visibility === 'private' && degree !== '1') continue;
    if (degreeFilter && !degreeFilter.has(degree)) continue;
    if (locationFilter && !member.location.toLowerCase().includes(locationFilter)) continue;
    if (companyFilter) {
      const current = await query<{ one: number }>(
        `SELECT 1 AS one FROM experience WHERE member_id = $1 AND end_ym IS NULL AND lower(company) = $2 LIMIT 1`,
        [member.id, companyFilter],
      );
      if (current.length === 0) continue;
    }
    matched.push({
      card: await personCard(viewerId, member),
      degree,
      name: member.name,
      id: member.id,
    });
  }
  matched.sort((a, b) => {
    if (DEGREE_RANK[a.degree] !== DEGREE_RANK[b.degree]) {
      return DEGREE_RANK[a.degree] - DEGREE_RANK[b.degree];
    }
    const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return byName !== 0 ? byName : a.id < b.id ? -1 : 1;
  });
  return matched.map((entry) => entry.card);
}

async function searchPosts(viewerId: string, words: string[]): Promise<Record<string, unknown>[]> {
  if (words.length === 0) return [];
  const rows = await query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM posts WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
  );
  const out: Record<string, unknown>[] = [];
  for (const post of rows) {
    if (!matchesQuery(words, [post.text])) continue;
    if (!(await postVisibleTo(viewerId, post))) continue;
    out.push(await postObject(viewerId, post));
  }
  return out;
}

async function searchJobs(
  viewerId: string,
  words: string[],
  ctx: Ctx,
): Promise<Record<string, unknown>[]> {
  const locationFilter = (ctx.search.get('location') ?? '').trim().toLowerCase();
  const workplaceFilter = (ctx.search.get('workplace') ?? '').trim();
  const posted = (ctx.search.get('posted') ?? '').trim();
  const windowSeconds: Record<string, number> = { day: 86400, week: 604800, month: 2592000 };

  const rows = await query<JobRow & { company_name: string }>(
    `SELECT ${JOB_COLUMNS.split(', ').map((column) => `j.${column}`).join(', ')}, c.name AS company_name
     FROM jobs j JOIN companies c ON c.id = j.company_id
     ORDER BY j.posted_at DESC, j.id DESC`,
  );
  const out: Record<string, unknown>[] = [];
  for (const job of rows) {
    if (!jobOpen(job)) continue;
    if (words.length > 0 && !matchesQuery(words, [job.title, job.company_name])) continue;
    if (locationFilter && !job.location.toLowerCase().includes(locationFilter)) continue;
    if (workplaceFilter && job.workplace !== workplaceFilter) continue;
    if (posted && windowSeconds[posted]) {
      const cutoff = businessNow().getTime() - windowSeconds[posted] * 1000;
      if (job.posted_at.getTime() < cutoff) continue;
    }
    out.push(await jobCard(viewerId, job));
  }
  return out;
}

export async function search(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const viewerId = requireMember(ctx);
  const type = ctx.search.get('type') ?? '';
  if (!['people', 'posts', 'jobs'].includes(type)) {
    throw validation({ type: 'Choose people, posts or jobs.' });
  }
  const q = ctx.search.get('q') ?? '';
  if ([...q].length > 100) {
    throw validation({ q: 'Search text can be up to 100 characters.' });
  }
  const words = q
    .toLowerCase()
    .split(' ')
    .map((word) => word.trim())
    .filter((word) => word !== '');

  const results =
    type === 'people'
      ? await searchPeople(viewerId, words, ctx)
      : type === 'posts'
        ? await searchPosts(viewerId, words)
        : await searchJobs(viewerId, words, ctx);

  const cursorRaw = ctx.search.get('cursor');
  const offset = cursorRaw ? Number(cursorRaw) : 0;
  if (cursorRaw && (!Number.isInteger(offset) || offset < 0)) {
    throw validation({ cursor: 'This cursor is not valid.' });
  }
  const page = results.slice(offset, offset + 20);
  return {
    status: 200,
    body: {
      type,
      q,
      total: results.length,
      results: page,
      next_cursor: offset + page.length < results.length ? String(offset + page.length) : null,
    },
  };
}
