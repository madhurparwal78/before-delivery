import { config } from '../core/config.js';
import { db, many, one, type Queryable } from '../core/db.js';
import { iso, isoOrNull, now } from '../core/time.js';
import { copy } from '../shared/copy.js';
import { encodeCursor, decodeCursor, type FeedSort } from './cursor.js';
import { moderates, publicUser, type Viewer } from './viewer.js';

export interface PostRow {
  id: string;
  community_id: string;
  community_name: string;
  author_id: string;
  author_username: string;
  author_created_at: unknown;
  title: string;
  body_md: string;
  body_html: string;
  spoiler: boolean;
  score: number;
  comment_count: number;
  hot_rank: number;
  state: 'published' | 'removed' | 'deleted';
  removal_reason: string | null;
  removal_at: unknown;
  locked_at: unknown;
  locked_until: unknown;
  pinned_at: unknown;
  version: number;
  created_at: unknown;
  edited_at: unknown;
  my_vote: number;
  cursor_time: string;
}

export interface ImageRow {
  id: string;
  post_id: string | null;
  sha256: string;
  alt: string | null;
  width: number;
  height: number;
  w320: number;
  w640: number;
  w1080: number;
}

export const POST_SELECT = `
  select p.id, p.community_id, c.name as community_name, p.author_id,
         a.username as author_username, a.created_at as author_created_at,
         p.title, p.body_md, p.body_html, p.spoiler, p.score, p.comment_count, p.hot_rank,
         p.state, p.removal_reason, p.removal_at, p.locked_at, p.locked_until, p.pinned_at,
         p.version, p.created_at, p.edited_at,
         to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time,
         coalesce(v.value, 0) as my_vote
  from posts p
  join communities c on c.id = p.community_id
  join members a on a.id = p.author_id
  left join votes v on v.target_type = 'post' and v.target_id = p.id and v.member_id = $1
`;

export function lockState(row: PostRow, at: Date = now()): { locked: boolean; lockedUntil: string | null } {
  if (!row.locked_at) return { locked: false, lockedUntil: null };
  if (row.locked_until && new Date(iso(row.locked_until)).getTime() <= at.getTime()) {
    return { locked: false, lockedUntil: null };
  }
  return { locked: true, lockedUntil: isoOrNull(row.locked_until) };
}

export function isArchived(row: PostRow, at: Date = now()): boolean {
  const created = new Date(iso(row.created_at)).getTime();
  return at.getTime() - created > config.limits.archiveAfterDays * 86400 * 1000;
}

export function imageProjection(row: ImageRow): Record<string, unknown> {
  const widths = [row.w320, row.w640, row.w1080];
  const srcset: string[] = [];
  let previous = 0;
  config.imageSlots.forEach((slot, index) => {
    const width = widths[index];
    if (width !== previous) {
      srcset.push(`/media/${row.id}/${slot}.webp ${width}w`);
      previous = width;
    }
  });
  return {
    id: String(row.id),
    alt: row.alt,
    width: row.width,
    height: row.height,
    src: `/media/${row.id}/640.webp`,
    srcset: srcset.join(', '),
  };
}

export async function loadImagesForPosts(postIds: string[]): Promise<Map<string, ImageRow[]>> {
  const byPost = new Map<string, ImageRow[]>();
  if (postIds.length === 0) return byPost;
  const rows = await many<ImageRow>(
    db,
    `select id, post_id, sha256, alt, width, height, w320, w640, w1080
     from images where post_id = any($1::bigint[]) order by position asc, id asc`,
    [postIds],
  );
  for (const row of rows) {
    const key = String(row.post_id);
    const list = byPost.get(key) ?? [];
    list.push(row);
    byPost.set(key, list);
  }
  return byPost;
}

export interface PostView {
  row: PostRow;
  images: ImageRow[];
}

/** The post projection: exactly the published keys, with the values the caller's role may see. */
export function postProjection(view: PostView, viewer: Viewer): Record<string, unknown> {
  const { row } = view;
  const isAuthor = viewer.member !== null && viewer.member.id === String(row.author_id);
  const isModerator = moderates(viewer, row.community_id);
  const privileged = isAuthor || isModerator;
  const { locked, lockedUntil } = lockState(row);

  const base: Record<string, unknown> = {
    id: String(row.id),
    communityName: row.community_name,
    author: publicUser(row.author_username, row.author_created_at),
    title: row.title,
    bodyHtml: row.body_html,
    images: view.images.map(imageProjection),
    spoiler: row.spoiler === true,
    score: Number(row.score),
    myVote: viewer.member ? Number(row.my_vote) : 0,
    commentCount: Number(row.comment_count),
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    state: row.state,
    removal: row.removal_reason === null ? null : { publicReason: row.removal_reason, at: iso(row.removal_at) },
    locked,
    lockedUntil,
    pinned: row.pinned_at !== null,
    archived: isArchived(row),
    version: Number(row.version),
    url: `/c/${row.community_name}/post/${row.id}`,
  };

  if (row.state === 'deleted') {
    base.title = copy.fixed.deletedPostTitle;
    base.bodyHtml = null;
    base.author = null;
    base.images = [];
  } else if (row.state === 'removed' && !privileged) {
    base.title = null;
    base.bodyHtml = null;
    base.author = null;
    base.images = [];
  }

  if (isAuthor) base.bodyMd = row.state === 'deleted' ? null : row.body_md;
  return base;
}

export async function projectPosts(rows: PostRow[], viewer: Viewer): Promise<Record<string, unknown>[]> {
  const images = await loadImagesForPosts(rows.map((row) => String(row.id)));
  return rows.map((row) => postProjection({ row, images: images.get(String(row.id)) ?? [] }, viewer));
}

export async function projectPost(row: PostRow, viewer: Viewer): Promise<Record<string, unknown>> {
  const images = await loadImagesForPosts([String(row.id)]);
  return postProjection({ row, images: images.get(String(row.id)) ?? [] }, viewer);
}

export async function loadPostRow(
  source: Queryable,
  postId: string,
  viewerId: string | null,
): Promise<PostRow | null> {
  if (!/^\d+$/.test(postId)) return null;
  return one<PostRow>(source, `${POST_SELECT} where p.id = $2`, [viewerId, postId]);
}

const ORDER: Record<FeedSort, string> = {
  hot: 'p.hot_rank desc, p.id desc',
  new: 'p.created_at desc, p.id desc',
  top: 'p.score desc, p.id desc',
};

function keysetPredicate(sort: FeedSort, parameterIndex: number): string {
  const column = sort === 'hot' ? 'p.hot_rank' : sort === 'new' ? 'p.created_at' : 'p.score';
  const cast = sort === 'hot' ? 'double precision' : sort === 'new' ? 'timestamptz' : 'integer';
  return `(${column}, p.id) < ($${parameterIndex}::${cast}, $${parameterIndex + 1}::bigint)`;
}

function cursorKey(row: PostRow, sort: FeedSort): string {
  if (sort === 'hot') return String(row.hot_rank);
  if (sort === 'new') return row.cursor_time;
  return String(row.score);
}

export interface FeedPage {
  rows: PostRow[];
  nextCursor: string | null;
}

export interface FeedQuery {
  sort: FeedSort;
  cursor: string | null;
  viewerId: string | null;
  scope: { kind: 'home'; memberId: string | null } | { kind: 'community'; communityId: string } | { kind: 'author'; authorId: string };
}

/** One keyset page of published posts in the published order, 25 rows behind an opaque cursor. */
export async function feedPage(query: FeedQuery): Promise<FeedPage> {
  const decoded = decodeCursor(query.cursor, query.sort);
  const values: unknown[] = [query.viewerId];
  const conditions = ["p.state = 'published'"];

  if (query.scope.kind === 'community') {
    values.push(query.scope.communityId);
    conditions.push(`p.community_id = $${values.length}`);
    conditions.push('p.pinned_at is null');
  } else if (query.scope.kind === 'author') {
    values.push(query.scope.authorId);
    conditions.push(`p.author_id = $${values.length}`);
  } else if (query.scope.memberId !== null) {
    values.push(query.scope.memberId);
    conditions.push(
      `p.community_id in (select community_id from memberships where member_id = $${values.length})`,
    );
  }

  if (decoded) {
    values.push(decoded.key, decoded.id);
    conditions.push(keysetPredicate(query.sort, values.length - 1));
  }

  const rows = await many<PostRow>(
    db,
    `${POST_SELECT} where ${conditions.join(' and ')} order by ${ORDER[query.sort]} limit ${config.pageSize + 1}`,
    values,
  );

  const page = rows.slice(0, config.pageSize);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > config.pageSize && last ? encodeCursor(query.sort, cursorKey(last, query.sort), String(last.id)) : null;
  return { rows: page, nextCursor };
}

export async function pinnedPosts(communityId: string, viewerId: string | null): Promise<PostRow[]> {
  return many<PostRow>(
    db,
    `${POST_SELECT} where p.community_id = $2 and p.state = 'published' and p.pinned_at is not null
     order by p.pinned_at asc, p.id asc`,
    [viewerId, communityId],
  );
}
