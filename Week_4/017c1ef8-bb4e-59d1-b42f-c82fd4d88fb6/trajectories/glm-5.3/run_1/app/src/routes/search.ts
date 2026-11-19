import { Router } from 'express';
import { query } from '../db.js';
import { businessMs } from '../clock.js';
import { errors } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { personCard, getMemberById } from '../profile.js';
import { blockedWith, connectionEdges, adjacencyFor, degree } from '../graph.js';
import { connectionStateFor } from '../domain/profile-shared.js';
import { loadPost, toPostObject, postVisibleTo, PostRow } from '../domain/posts.js';
import { jobOpen } from '../domain/jobs.js';

const PAGE = 20;

const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
const matches = (target: string, queryWords: string[]): boolean =>
  queryWords.every((qw) => words(target).some((tw) => tw.startsWith(qw)));

export const searchRouter = (): Router => {
  const router = Router();
  router.use('/search', requireSession);
  router.use('/notifications', requireSession);

  router.get('/search', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const type = req.query.type;
    if (type !== 'people' && type !== 'posts' && type !== 'jobs') {
      throw errors.validation({ type: 'Choose people, posts or jobs.' });
    }
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if ([...q].length > 100) throw errors.validation({ q: 'Search text can be up to 100 characters.' });
    const queryWords = words(q);
    const blocked = await blockedWith(viewerId);

    if (type === 'people') {
      const degreeFilter = typeof req.query.degree === 'string' && req.query.degree !== ''
        ? req.query.degree.split(',').filter((d) => ['1', '2', '3'].includes(d)) : [];
      const company = typeof req.query.company === 'string' ? req.query.company : '';
      const location = typeof req.query.location === 'string' ? req.query.location : '';
      const members = await query(`SELECT id FROM members WHERE id <> $1`, [viewerId]);
      const edges = await connectionEdges();
      const adj = adjacencyFor(edges, blocked);
      const results: unknown[] = [];
      const candidates: { card: Record<string, unknown>; order: [number, string, string] }[] = [];
      for (const row of members.rows) {
        const member = await getMemberById(row.id);
        if (!member) continue;
        if (blocked.has(row.id)) continue;
        if (member.visibility === 'private') {
          const state = await connectionStateFor(viewerId, row.id);
          if (state !== 'connected') continue;
        }
        if (queryWords.length > 0) {
          const nameOrHeadline = `${member.name} ${member.headline}`;
          if (!matches(nameOrHeadline, queryWords)) continue;
        }
        if (company) {
          const current = await query(
            `SELECT 1 FROM experience WHERE member_id = $1 AND end_month IS NULL AND lower(company) = lower($2)`,
            [row.id, company]);
          if (current.rows.length === 0) continue;
        }
        if (location) {
          if (!member.location.toLowerCase().includes(location.toLowerCase())) continue;
        }
        const deg = degree(viewerId, row.id, adj);
        if (degreeFilter.length > 0 && degreeFilter.length < 3) {
          if (deg === null || !degreeFilter.includes(String(deg))) continue;
        }
        const card = await personCard(viewerId, member);
        results.push(card);
        candidates.push({
          card,
          order: [deg === null ? 99 : deg, member.name.toLowerCase(), member.id],
        });
      }
      candidates.sort((a, b) => a.order[0] - b.order[0] || a.order[1].localeCompare(b.order[1]) || a.order[2].localeCompare(b.order[2]));
      const sorted = candidates.map((c) => c.card);
      res.json({ type, q, total: sorted.length, results: sorted.slice(0, PAGE), next_cursor: sorted.length > PAGE ? '1' : null });
      return;
    }

    if (type === 'posts') {
      const posts = await query<PostRow>(
        `SELECT id, author_id, text, photo_id, shared_post_id, created_at, edited_at, deleted
         FROM posts WHERE deleted = false ORDER BY created_at DESC`);
      const results: unknown[] = [];
      for (const post of posts.rows) {
        if (queryWords.length > 0 && !matches(post.text, queryWords)) continue;
        if (!(await postVisibleTo(viewerId, post.author_id, blocked))) continue;
        results.push(await toPostObject(viewerId, post));
      }
      res.json({ type, q, total: results.length, results: results.slice(0, PAGE), next_cursor: results.length > PAGE ? '1' : null });
      return;
    }

    // Jobs
    const jobs = await query<{
      id: string; title: string; company_id: string; company_name: string; company_handle: string;
      location: string; workplace: string; posted_at: Date; closes_at: Date;
    }>(
      `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.handle AS company_handle,
              j.location, j.workplace, j.posted_at, j.closes_at
       FROM jobs j JOIN companies c ON c.id = j.company_id ORDER BY j.posted_at DESC`);
    const locationFilter = typeof req.query.location === 'string' ? req.query.location : '';
    const workplace = typeof req.query.workplace === 'string' ? req.query.workplace : '';
    const posted = typeof req.query.posted === 'string' ? req.query.posted : '';
    const nowMs = businessMs();
    const results: unknown[] = [];
    for (const job of jobs.rows) {
      if (!jobOpen(job.closes_at)) continue;
      if (queryWords.length > 0 && !matches(`${job.title} ${job.company_name}`, queryWords)) continue;
      if (locationFilter && !job.location.toLowerCase().includes(locationFilter.toLowerCase())) continue;
      if (workplace && job.workplace !== workplace) continue;
      if (posted) {
        const limit = posted === 'day' ? 86_400_000 : posted === 'week' ? 604_800_000 : posted === 'month' ? 2_592_000_000 : 0;
        if (limit > 0 && nowMs - job.posted_at.getTime() > limit) continue;
      }
      const saved = await query(`SELECT 1 FROM saved_jobs WHERE member_id = $1 AND job_id = $2`, [viewerId, job.id]);
      const applied = await query(`SELECT 1 FROM applications WHERE job_id = $1 AND applicant_id = $2`, [job.id, viewerId]);
      results.push({
        id: job.id, title: job.title,
        company: { id: job.company_id, name: job.company_name, handle: job.company_handle },
        location: job.location, workplace: job.workplace,
        posted_at: job.posted_at.toISOString(), closes_at: job.closes_at.toISOString(),
        open: true, saved: saved.rows.length > 0, applied: applied.rows.length > 0,
      });
    }
    res.json({ type, q, total: results.length, results: results.slice(0, PAGE), next_cursor: results.length > PAGE ? '1' : null });
  }));

  return router;
};

export const notificationsRouter = (): Router => {
  const router = Router();
  router.use('/search', requireSession);
  router.use('/notifications', requireSession);

  router.get('/notifications', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const result = await query<{
      id: string; kind: string; count: number; post_id: string | null; comment_id: string | null;
      skill_id: string | null; actor_id: string | null; created_at: Date; updated_at: Date;
      seen_at: Date | null; actor_name: string | null;
    }>(
      `SELECT n.id, n.kind, n.count, n.post_id, n.comment_id, n.skill_id, n.actor_id,
              n.created_at, n.updated_at, n.seen_at, m.name AS actor_name
       FROM notifications n LEFT JOIN members m ON m.id = n.actor_id
       WHERE n.member_id = $1 ORDER BY n.updated_at DESC LIMIT 50`, [viewerId]);
    const items = [];
    const blocked = await blockedWith(viewerId);
    for (const row of result.rows) {
      if (row.actor_id && blocked.has(row.actor_id)) continue;
      if (row.post_id) {
        const post = await loadPost(row.post_id);
        if (!post) continue;
      }
      const name = row.actor_name ?? 'Someone';
      let text = '';
      switch (row.kind) {
        case 'invitation_received': text = `${name} wants to connect`; break;
        case 'invitation_accepted': text = `${name} accepted your invitation`; break;
        case 'reaction': text = row.count === 1 ? `${name} reacted to your post` : row.count === 2 ? `${name} and 1 other reacted to your post` : `${name} and ${row.count - 1} others reacted to your post`; break;
        case 'comment': text = row.count === 1 ? `${name} commented on your post` : row.count === 2 ? `${name} and 1 other commented on your post` : `${name} and ${row.count - 1} others commented on your post`; break;
        case 'reply': text = `${name} replied to your comment`; break;
        case 'mention': text = `${name} mentioned you in a post`; break;
        case 'repost': text = `${name} reposted your post`; break;
        case 'endorsement': {
          const skill = row.skill_id
            ? await query<{ name: string }>(`SELECT name FROM skills WHERE id = $1`, [row.skill_id])
            : null;
          text = `${name} endorsed you for ${skill?.rows[0]?.name ?? 'a skill'}`;
          break;
        }
        case 'application_status': text = 'Application status changed'; break;
        default: text = '';
      }
      const seen = row.seen_at !== null && row.seen_at >= row.updated_at;
      items.push({
        id: row.id, kind: row.kind, count: row.count,
        actors: row.actor_id ? [{ id: row.actor_id, name }] : [],
        text, target_url: targetUrlFor(row), created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(), unread: !seen,
      });
    }
    const unreadCount = items.filter((i) => i.unread).length;
    res.json({ items, unread_count: unreadCount });
  }));

  router.post('/notifications/seen', wrap(async (req, res) => {
    await query(`UPDATE notifications SET seen_at = $1 WHERE member_id = $2`, [new Date(businessMs()), req.auth!.memberId]);
    res.json({ unread_count: 0 });
  }));

  return router;
};

const targetUrlFor = (row: { kind: string; post_id: string | null; comment_id: string | null; skill_id: string | null }): string => {
  if (row.post_id) return `/posts/${row.post_id}`;
  if (row.kind === 'invitation_received' || row.kind === 'endorsement') return '/network';
  return '/feed';
};
