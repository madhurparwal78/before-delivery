import { query } from '../db.js';
import { errors } from '../errors.js';
import { config } from '../config.js';
import { businessMs } from '../clock.js';
import { getMemberById, blockedWith, connectionStateFor, degreeTo } from './profile-shared.js';

export type Mention = { handle: string; member_id: string; name: string };

const HANDLE = '[a-z0-9-]{3,30}';
const MENTION_RE = new RegExp(`(?:^|\\s)@(${HANDLE})`, 'g');
const HASHTAG_RE = /(?:^|\s)#([A-Za-z0-9_]{1,50})/g;


/** Resolved mentions: only handles that are the author's 1st-degree connections right now. */
export const resolveMentions = async (authorId: string, text: string): Promise<Mention[]> => {
  const handles: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) handles.push(match[1]);
  const unique = [...new Set(handles)];
  const out: Mention[] = [];
  for (const handle of unique) {
    const member = await getMemberById(handle);
    if (!member || member.handle !== handle) {
      const result = await query(`SELECT id, handle, name FROM members WHERE handle = $1`, [handle]);
      if (result.rows.length === 0) continue;
      const row = result.rows[0];
      const state = await connectionStateFor(authorId, row.id);
      if (state === 'connected') out.push({ handle, member_id: row.id, name: row.name });
    } else {
      const state = await connectionStateFor(authorId, member.id);
      if (state === 'connected') out.push({ handle, member_id: member.id, name: member.name });
    }
  }
  return out;
};

export const extractHashtags = (text: string): string[] => {
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_RE)) tags.push(match[1]);
  return [...new Set(tags)];
};

export const codePoints = (text: string): number => [...text].length;

export const postVisibleTo = async (viewerId: string, postAuthorId: string, blocked: Set<string>): Promise<boolean> => {
  if (blocked.has(postAuthorId)) return false;
  if (postAuthorId === viewerId) return true;
  const author = await getMemberById(postAuthorId);
  if (!author) return false;
  if (author.visibility === 'private') {
    const state = await connectionStateFor(viewerId, author.id);
    return state === 'connected';
  }
  return true;
};

export type PostRow = {
  id: string; author_id: string; text: string; photo_id: string | null;
  shared_post_id: string | null; created_at: Date; edited_at: Date | null; deleted: boolean;
};

export const loadPost = async (id: string): Promise<PostRow | undefined> => {
  const result = await query<PostRow>(
    `SELECT id, author_id, text, photo_id, shared_post_id, created_at, edited_at, deleted
     FROM posts WHERE id = $1 AND deleted = false`, [id]);
  return result.rows[0];
};

export const loadPostOrThrow = async (id: string): Promise<PostRow> => {
  const post = await loadPost(id);
  if (!post) throw errors.notFound();
  return post;
};

export const summaryFor = async (post: PostRow, viewerId: string): Promise<{
  reactions: { count: number; mine: string | null; top_types: string[]; text: string };
}> => {
  const blocked = await blockedWith(viewerId);
  const result = await query<{ type: string; at: Date; member_id: string; name: string }>(
    `SELECT r.type, r.at, r.member_id, m.name FROM reactions r JOIN members m ON m.id = r.member_id
     WHERE r.post_id = $1 ORDER BY r.at DESC`, [post.id]);
  const rows = result.rows.filter((row) => !blocked.has(row.member_id));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  const mine = rows.find((row) => row.member_id === viewerId)?.type ?? null;
  const total = rows.length;
  const typesInOrder = ['like', 'celebrate', 'support', 'insightful', 'funny'];
  const topTypes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || typesInOrder.indexOf(a[0]) - typesInOrder.indexOf(b[0]))
    .slice(0, 3)
    .map(([type]) => type);
  let text = '';
  if (total > 0) {
    if (mine) {
      if (total === 1) text = 'You';
      else if (total === 2) text = 'You and 1 other';
      else text = `You and ${total - 1} others`;
    } else {
      const connectionRows = await Promise.all(
        rows.filter((row) => row.member_id !== viewerId).map(async (row) => ({
          row,
          state: await connectionStateFor(viewerId, row.member_id),
        })),
      );
      const firstDegree = connectionRows.filter((c) => c.state === 'connected');
      if (firstDegree.length > 0) {
        const mostRecent = firstDegree.reduce((best, cur) => {
          if (cur.row.at > best.row.at) return cur;
          if (cur.row.at.getTime() === best.row.at.getTime() && cur.row.name.toLowerCase() < best.row.name.toLowerCase()) return cur;
          return best;
        });
        const name = mostRecent.row.name;
        if (total === 1) text = name;
        else if (total === 2) text = `${name} and 1 other`;
        else text = `${name} and ${total - 1} others`;
      } else {
        text = total === 1 ? '1 reaction' : `${total} reactions`;
      }
    }
  }
  return { reactions: { count: total, mine, top_types: topTypes, text } };
};

export const commentCount = async (postId: string, viewerId: string): Promise<number> => {
  const blocked = await blockedWith(viewerId);
  const all = await query<{ author_id: string }>(
    `SELECT author_id FROM comments WHERE post_id = $1 AND deleted = false`, [postId]);
  return all.rows.filter((row) => !blocked.has(row.author_id)).length;
};

export const repostCount = async (postId: string, viewerId: string): Promise<number> => {
  const blocked = await blockedWith(viewerId);
  const all = await query<{ member_id: string }>(
    `SELECT member_id FROM reposts WHERE post_id = $1`, [postId]);
  return all.rows.filter((row) => !blocked.has(row.member_id)).length;
};

export const editableNow = (createdAt: Date): boolean =>
  businessMs() < createdAt.getTime() + config.editWindowSeconds * 1000;

export type PostObject = {
  id: string;
  author: { id: string; handle: string; name: string; headline: string; degree: string };
  text: string;
  mentions: Mention[];
  hashtags: string[];
  created_at: string;
  edited_at: string | null;
  editable: boolean;
  photo_url: string | null;
  reactions: { count: number; mine: string | null; top_types: string[]; text: string };
  comment_count: number;
  repost_count: number;
  reposted_by_me: boolean;
  shared: unknown;
};

export const toPostObject = async (viewerId: string, post: PostRow): Promise<PostObject> => {
  const author = await getMemberById(post.author_id);
  const mentions = await resolveMentions(post.author_id, post.text);
  const blocked = await blockedWith(viewerId);
  const deg = author ? await degreeTo(viewerId, author.id, blocked) : null;
  const { reactions } = await summaryFor(post, viewerId);
  const comments = await commentCount(post.id, viewerId);
  const reposts = await repostCount(post.id, viewerId);
  const reposted = await query(`SELECT 1 FROM reposts WHERE post_id = $1 AND member_id = $2`, [post.id, viewerId]);
  let shared: unknown = null;
  if (post.shared_post_id) {
    const original = await loadPost(post.shared_post_id);
    if (original) {
      const visible = await postVisibleTo(viewerId, original.author_id, blocked);
      shared = visible ? await toPostObject(viewerId, original) : { unavailable: true };
    } else {
      shared = { unavailable: true };
    }
  }
  return {
    id: post.id,
    author: {
      id: author?.id ?? '', handle: author?.handle ?? '', name: author?.name ?? '',
      headline: author?.headline ?? '', degree: deg === null ? 'out' : String(deg),
    },
    text: post.text,
    mentions,
    hashtags: extractHashtags(post.text),
    created_at: post.created_at.toISOString(),
    edited_at: post.edited_at ? post.edited_at.toISOString() : null,
    editable: editableNow(post.created_at),
    photo_url: post.photo_id ? `/media/photos/${post.photo_id}` : null,
    reactions,
    comment_count: comments,
    repost_count: reposts,
    reposted_by_me: reposted.rows.length > 0,
    shared,
  };
};
