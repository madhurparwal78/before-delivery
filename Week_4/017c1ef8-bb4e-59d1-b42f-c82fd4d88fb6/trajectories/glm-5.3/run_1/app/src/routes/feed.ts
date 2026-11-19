import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { loadPost, toPostObject, postVisibleTo, PostRow } from '../domain/posts.js';
import { blockedWith } from '../domain/profile-shared.js';

type EntryRow = {
  entry_id: string; kind: 'post' | 'repost'; created_at: Date;
  post_id: string; reposter_id: string | null;
};

const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

const decodeCursor = (cursor: string): { createdAt: Date; id: string } | null => {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

/** Feed entries: posts and plain reposts by the viewer, connections and followed targets. */
const eligibleEntries = async (viewerId: string): Promise<EntryRow[]> => {
  const followRows = await query<{ target_id: string }>(
    `SELECT target_id FROM follows WHERE follower_id = $1`, [viewerId]);
  const followedMembers = new Set<string>();
  const followedCompanies = new Set<string>();
  for (const row of followRows.rows) {
    const member = await query(`SELECT 1 FROM members WHERE id = $1`, [row.target_id]);
    if (member.rows.length > 0) followedMembers.add(row.target_id);
    else followedCompanies.add(row.target_id);
  }
  // Admins of a followed company: their posts are the company's posts.
  for (const companyId of followedCompanies) {
    const admins = await query<{ member_id: string }>(
      `SELECT member_id FROM company_admins WHERE company_id = $1`, [companyId]);
    for (const admin of admins.rows) followedMembers.add(admin.member_id);
  }
  const connectionRows = await query<{ other_id: string }>(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS other_id
     FROM connections WHERE state = 'connected' AND ($1 = requester_id OR $1 = addressee_id)`, [viewerId]);
  const allowedAuthors = new Set<string>([viewerId]);
  for (const row of connectionRows.rows) allowedAuthors.add(row.other_id);
  for (const id of followedMembers) allowedAuthors.add(id);

  const authorList = [...allowedAuthors];
  const postRows = await query<{ id: string; author_id: string; created_at: Date }>(
    `SELECT id, author_id, created_at FROM posts
     WHERE deleted = false AND shared_post_id IS NULL AND author_id = ANY($1::text[])`,
    [authorList]);
  const repostRows = await query<{ id: string; member_id: string; post_id: string; created_at: Date }>(
    `SELECT r.id, r.member_id, r.post_id, r.created_at FROM reposts r
     JOIN posts p ON p.id = r.post_id AND p.deleted = false
     WHERE r.member_id = ANY($1::text[])`, [authorList]);
  // Thought reposts are posts themselves (already in postRows); plain reposts only here.
  const entries: EntryRow[] = [];
  for (const row of postRows.rows) {
    entries.push({ entry_id: row.id, kind: 'post', created_at: row.created_at, post_id: row.id, reposter_id: null });
  }
  for (const row of repostRows.rows) {
    entries.push({ entry_id: row.id, kind: 'repost', created_at: row.created_at, post_id: row.post_id, reposter_id: row.member_id });
  }
  return entries;
};

const dedupeByOriginal = (entries: EntryRow[]): EntryRow[] => {
  // One entry per original post: keep the newest of the original and its plain reposts.
  const byOriginal = new Map<string, EntryRow>();
  for (const entry of entries) {
    const existing = byOriginal.get(entry.post_id);
    if (!existing) { byOriginal.set(entry.post_id, entry); continue; }
    if (entry.created_at > existing.created_at ||
        (entry.created_at.getTime() === existing.created_at.getTime() && entry.entry_id > existing.entry_id)) {
      byOriginal.set(entry.post_id, entry);
    }
  }
  return [...byOriginal.values()].sort((a, b) =>
    b.created_at.getTime() - a.created_at.getTime() || (b.entry_id > a.entry_id ? 1 : -1));
};

export const feedRouter = (): Router => {
  const router = Router();
  router.use('/feed', requireSession);
  router.use('/hashtags', requireSession);

  router.get('/feed', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const blocked = await blockedWith(viewerId);
    const newerThan = req.query.newer_than;
    const cursor = req.query.cursor;
    const entries = dedupeByOriginal(await eligibleEntries(viewerId));

    const visible: EntryRow[] = [];
    for (const entry of entries) {
      const post = await loadPost(entry.post_id);
      if (!post) continue;
      const authorVisible = await postVisibleTo(viewerId, post.author_id, blocked);
      if (!authorVisible) continue;
      if (entry.kind === 'repost') {
        const reposterVisible = await postVisibleTo(viewerId, entry.reposter_id!, blocked);
        if (!reposterVisible) continue;
      }
      visible.push(entry);
    }

    if (typeof newerThan === 'string' && newerThan !== '') {
      const boundary = decodeCursor(newerThan);
      if (!boundary) throw errors.validation({ cursor: 'This cursor is not valid.' });
      const fresh = visible.filter((e) =>
        e.created_at > boundary.createdAt ||
        (e.created_at.getTime() === boundary.createdAt.getTime() && e.entry_id > boundary.id));
      const sliced = fresh.slice(0, 50);
      res.json({
        entries: await toEntries(viewerId, sliced),
        top_cursor: visible.length > 0 ? encodeCursor(visible[0].created_at, visible[0].entry_id) : newerThan,
      });
      return;
    }

    let page: EntryRow[] = visible;
    let nextCursor: string | null = null;
    if (typeof cursor === 'string' && cursor !== '') {
      const boundary = decodeCursor(cursor);
      if (!boundary) throw errors.validation({ cursor: 'This cursor is not valid.' });
      const idx = visible.findIndex((e) =>
        e.created_at.getTime() === boundary.createdAt.getTime() && e.entry_id === boundary.id);
      page = idx >= 0 ? visible.slice(idx + 1) : [];
    }
    const pageSize = config.feedPageSize;
    const hasMore = page.length > pageSize;
    const shown = hasMore ? page.slice(0, pageSize) : page;
    if (hasMore) {
      const last = shown[shown.length - 1];
      nextCursor = encodeCursor(last.created_at, last.entry_id);
    }
    const top = visible.length > 0 ? encodeCursor(visible[0].created_at, visible[0].entry_id) : null;
    res.json({ entries: await toEntries(viewerId, shown), next_cursor: nextCursor, top_cursor: top });
  }));

  router.get('/hashtags/:tag', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const blocked = await blockedWith(viewerId);
    const tag = req.params.tag.toLowerCase();
    const rows = (await query<{ id: string; text: string; created_at: Date; author_id: string; shared_post_id: string | null }>(
      `SELECT id, text, created_at, author_id, shared_post_id FROM posts WHERE deleted = false ORDER BY created_at DESC`)).rows;
    const matching: PostRow[] = [];
    for (const row of rows) {
      if (row.shared_post_id) {
        // Only its own text counts.
      }
      const tags: string[] = row.text.match(/(?:^|\s)#([A-Za-z0-9_]{1,50})/g) ?? [];
      const carries = tags.some((t) => t.trim().slice(1).toLowerCase() === tag);
      if (!carries) continue;
      if (!(await postVisibleTo(viewerId, row.author_id, blocked))) continue;
      matching.push({
        id: row.id, author_id: row.author_id, text: row.text, photo_id: null,
        shared_post_id: row.shared_post_id, created_at: row.created_at, edited_at: null, deleted: false,
      });
    }
    const posts = await Promise.all(matching.map((p) => toPostObject(viewerId, p)));
    const nowMs = (await import('../clock.js')).businessMs();
    const authors = new Set<string>();
    for (const p of matching) {
      if (nowMs - p.created_at.getTime() <= 604_800_000) authors.add(p.author_id);
    }
    const members = authors.size;
    res.json({ posts, next_cursor: null, stats: { posts: posts.length, members } });
  }));

  return router;
};

const toEntries = async (viewerId: string, rows: EntryRow[]): Promise<unknown[]> => {
  const out = [];
  for (const entry of rows) {
    const post = await loadPost(entry.post_id);
    if (!post) continue;
    let reposter: { id: string; name: string; handle: string } | null = null;
    if (entry.kind === 'repost' && entry.reposter_id) {
      const member = await (await import('../domain/profile-shared.js')).getMemberById(entry.reposter_id);
      reposter = member ? { id: member.id, name: member.name, handle: member.handle } : null;
    }
    out.push({
      entry_id: entry.entry_id,
      kind: entry.kind,
      created_at: entry.created_at.toISOString(),
      post: await toPostObject(viewerId, post),
      reposter,
    });
  }
  return out;
};
