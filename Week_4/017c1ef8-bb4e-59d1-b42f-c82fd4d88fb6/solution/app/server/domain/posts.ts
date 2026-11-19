import { closedEditWindowCreations, now, postIsEditable } from '../clock.js';
import { config } from '../config.js';
import { maybeRow, pool, rows, type Db, type Tx } from '../db.js';
import { conflict, forbidden, notFound, validation } from '../errors.js';
import { newId } from '../ids.js';
import { publish } from '../live.js';
import { onTick } from '../tick.js';
import { commentCounts, reactionSummaries, repostStats, type ReactionSummary, type RepostStats } from './counts.js';
import { notify } from './notify.js';
import { announcePost } from './post-events.js';
import { degreesFrom, type Degree } from './people.js';
import { checkedText, hashtagsIn, mentionObjects, parseText, saveHashtags, type MentionObject, type ResolvedMention } from './text.js';
import { memberVisibleTo } from './visibility.js';

interface PostAuthor {
  id: string;
  handle: string;
  name: string;
  headline: string;
  degree: Degree;
}

export interface PostObject {
  id: string;
  author: PostAuthor;
  text: string;
  mentions: MentionObject[];
  hashtags: string[];
  created_at: Date;
  edited_at: Date | null;
  editable: boolean;
  photo_url: string | null;
  reactions: ReactionSummary;
  comment_count: number;
  repost_count: number;
  reposted_by_me: boolean;
  shared: PostObject | { unavailable: true } | null;
}

interface PostRow {
  id: string;
  author_id: string;
  handle: string;
  name: string;
  headline: string;
  text: string;
  mentions: ResolvedMention[];
  created_at: Date;
  edited_at: Date | null;
  photo_id: string | null;
  shared_post_id: string | null;
}

async function visiblePostRows(db: Db, viewerId: string, ids: string[]): Promise<PostRow[]> {
  return rows<PostRow>(
    db,
    `SELECT p.id, p.author_id, m.handle, m.name, m.headline, p.text, p.mentions, p.created_at, p.edited_at, p.photo_id, p.shared_post_id
       FROM posts p JOIN members m ON m.id = p.author_id
      WHERE p.id = ANY($2) AND ${memberVisibleTo('$1', 'm')}`,
    [viewerId, ids],
  );
}

/** The post objects the viewer may see, by id. A post by a blocked or private-to-the-viewer member is simply absent. */
export async function postObjects(db: Db, viewerId: string, ids: string[], embedShared = true): Promise<Map<string, PostObject>> {
  const found = await visiblePostRows(db, viewerId, ids);
  const postIds = found.map((post) => post.id);
  const degrees = await degreesFrom(db, viewerId, [...new Set(found.map((post) => post.author_id))]);
  const reactions = await reactionSummaries(db, viewerId, postIds);
  const comments = await commentCounts(db, viewerId, postIds);
  const reposts = await repostStats(db, viewerId, postIds);
  const mentions = await mentionObjects(db, viewerId, found.map((post) => post.mentions));
  const originals = embedShared
    ? await postObjects(db, viewerId, found.flatMap((post) => (post.shared_post_id ? [post.shared_post_id] : [])), false)
    : new Map<string, PostObject>();
  const at = now();
  return new Map(
    found.map((post, index) => {
      const stats = reposts.get(post.id) as RepostStats;
      const object: PostObject = {
        id: post.id,
        author: { id: post.author_id, handle: post.handle, name: post.name, headline: post.headline, degree: degrees.get(post.author_id) as Degree },
        text: post.text,
        mentions: mentions[index] as MentionObject[],
        hashtags: hashtagsIn(post.text),
        created_at: post.created_at,
        edited_at: post.edited_at,
        editable: post.author_id === viewerId && postIsEditable(post.created_at, at),
        photo_url: post.photo_id ? `/media/photos/${post.photo_id}` : null,
        reactions: reactions.get(post.id) as ReactionSummary,
        comment_count: comments.get(post.id) as number,
        repost_count: stats.count,
        reposted_by_me: stats.byMe,
        shared: post.shared_post_id && embedShared ? (originals.get(post.shared_post_id) ?? { unavailable: true }) : null,
      };
      return [post.id, object];
    }),
  );
}

export async function postObject(db: Db, viewerId: string, id: string): Promise<PostObject> {
  const object = (await postObjects(db, viewerId, [id])).get(id);
  if (!object) throw notFound();
  return object;
}

interface VisiblePost {
  id: string;
  author_id: string;
  text: string;
  mentions: ResolvedMention[];
  created_at: Date;
}

/** The post as a row, or not found when it is missing or hidden from the viewer. */
export async function visiblePost(db: Db, viewerId: string, id: string): Promise<VisiblePost> {
  const post = (await visiblePostRows(db, viewerId, [id]))[0];
  if (!post) throw notFound();
  return post;
}

interface NewPost {
  text: unknown;
  photo_id: unknown;
  shared_post_id: unknown;
}

interface PostReferences {
  photoId: string | null;
  shared: VisiblePost | null;
}

/** The 404 checks of a create: a photo the member uploaded and an original the member can see. */
export async function resolveReferences(db: Db, viewerId: string, input: NewPost): Promise<PostReferences> {
  const idOrNull = (value: unknown, field: string): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw validation({ [field]: 'Invalid id.' });
    return value;
  };
  const sharedId = idOrNull(input.shared_post_id, 'shared_post_id');
  const photoId = idOrNull(input.photo_id, 'photo_id');
  const shared = sharedId ? await visiblePost(db, viewerId, sharedId) : null;
  if (photoId && !(await maybeRow(db, 'SELECT 1 FROM photos WHERE id = $1 AND member_id = $2', [photoId, viewerId]))) throw notFound();
  return { photoId, shared };
}

async function notifyMentions(tx: Tx, post: { id: string; author_id: string }, mentioned: ResolvedMention[], already: ResolvedMention[]): Promise<void> {
  const known = new Set(already.map((mention) => mention.member_id));
  for (const mention of mentioned) {
    if (!known.has(mention.member_id)) await notify(tx, { memberId: mention.member_id, kind: 'mention', actorId: post.author_id, postId: post.id });
  }
}

export async function createPost(tx: Tx, authorId: string, input: NewPost, references: PostReferences, at: Date): Promise<string> {
  const text = checkedText(input.text, config.postMaxChars, `Posts can be up to ${config.postMaxChars.toLocaleString('en-US')} characters.`);
  const parsed = await parseText(tx, authorId, text);
  const id = newId();
  await tx.query(
    'INSERT INTO posts (id, author_id, text, mentions, created_at, photo_id, shared_post_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, authorId, text, JSON.stringify(parsed.mentions), at, references.photoId, references.shared?.id ?? null],
  );
  await saveHashtags(tx, id, parsed.hashtags);
  const post = { id, author_id: authorId };
  await notifyMentions(tx, post, parsed.mentions, []);
  if (references.shared) await notify(tx, { memberId: references.shared.author_id, kind: 'repost', actorId: authorId, postId: references.shared.id, detail: id });
  announcePost(tx, 'created', post);
  return id;
}

/** Edits a post: the author only, while the edit window is open. Mentions resolve again; only new ones are notified. */
export async function editPost(tx: Tx, viewerId: string, id: string, textInput: unknown, at: Date): Promise<void> {
  const post = await visiblePost(tx, viewerId, id);
  if (post.author_id !== viewerId) throw forbidden('not_author');
  if (!postIsEditable(post.created_at, at)) throw conflict('edit_window_closed');
  const text = checkedText(textInput, config.postMaxChars, `Posts can be up to ${config.postMaxChars.toLocaleString('en-US')} characters.`);
  const parsed = await parseText(tx, viewerId, text);
  await tx.query('UPDATE posts SET text = $2, mentions = $3, edited_at = $4 WHERE id = $1', [id, text, JSON.stringify(parsed.mentions), at]);
  await saveHashtags(tx, id, parsed.hashtags);
  await notifyMentions(tx, post, parsed.mentions, post.mentions);
  announcePost(tx, 'updated', post);
}

/** Deletes a post for good: its reactions, comments, plain reposts and notifications go with it. */
export async function deletePost(tx: Tx, viewerId: string, id: string): Promise<void> {
  const post = await visiblePost(tx, viewerId, id);
  if (post.author_id !== viewerId) throw forbidden('not_author');
  await tx.query('DELETE FROM posts WHERE id = $1', [id]);
  await tx.query(`DELETE FROM notifications WHERE kind = 'repost' AND detail = $1`, [id]);
  announcePost(tx, 'deleted', post);
}

/** Tells authors when a post's edit window has just closed, so open pages stop offering Edit. */
export function registerPostTick(): void {
  onTick(async (previous, current) => {
    const [from, to] = closedEditWindowCreations(previous, current);
    const closing = await rows<{ id: string; author_id: string }>(pool, 'SELECT id, author_id FROM posts WHERE created_at > $1 AND created_at <= $2', [from, to]);
    for (const post of closing) publish([post.author_id], { type: 'post', post_id: post.id, change: 'updated', author_id: post.author_id });
  });
}
