import type { PostDto, PostState, PostsListing, PushState, Role, SectionDto, SortMode } from '../shared/types';
import { SORT_LABELS, POSITION_COPY, MOVE_COPY } from '../shared/copy';
import type { BoardRow } from './boards';
import type { Db } from './db';
import { invalid, moveConflict, notFound } from './errors';

export interface PostRow {
  id: string;
  board_id: string;
  section_id: string;
  author_id: string;
  title: string;
  body: string;
  state: PostState;
  position: number | null;
  version: number;
  push_state: PushState | null;
  created_at: Date;
  seq: string;
  author_name: string;
  section_title: string;
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  my_vote: number;
  attachment_id: string | null;
  file_name: string | null;
  content_type: string | null;
  size: number | null;
  object_key: string | null;
  last_actor_name: string;
}

const POST_SELECT = `select p.id, p.board_id, p.section_id, p.author_id, p.title, p.body, p.state, p.position,
    p.version, p.push_state, p.created_at, p.seq,
    u.display_name as author_name, s.title as section_title,
    (select count(*) from likes l where l.post_id = p.id)::int as likes,
    (select coalesce(sum(v.value), 0) from votes v where v.post_id = p.id)::int as score,
    (select count(*) from comments c where c.post_id = p.id)::int as comments,
    exists(select 1 from likes l where l.post_id = p.id and l.user_id = $1) as liked,
    coalesce((select v.value from votes v where v.post_id = p.id and v.user_id = $1), 0)::int as my_vote,
    a.id as attachment_id, a.file_name, a.content_type, a.size, a.object_key,
    coalesce(la.display_name, u.display_name) as last_actor_name
  from posts p
    join users u on u.id = p.author_id
    join sections s on s.id = p.section_id
    left join attachments a on a.post_id = p.id
    left join users la on la.id = p.last_actor_id`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loadPostRow = async (db: Db, postId: string, callerId: string | null): Promise<PostRow | null> => {
  if (!UUID_PATTERN.test(postId)) return null;
  const result = await db.query<PostRow>(`${POST_SELECT} where p.id = $2`, [callerId, postId]);
  return result.rows[0] ?? null;
};

export const loadBoardPostRows = async (db: Db, boardId: string, callerId: string | null): Promise<PostRow[]> => {
  const result = await db.query<PostRow>(`${POST_SELECT} where p.board_id = $2 and p.state <> 'rejected' order by p.seq`, [
    callerId,
    boardId,
  ]);
  return result.rows;
};

export const canSeePost = (row: PostRow, role: Role | null, userId: string | null): boolean => {
  if (row.state === 'published') return true;
  if (row.state === 'rejected') return false;
  return row.author_id === userId || role === 'moderator' || role === 'owner';
};

const isoSeconds = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

export const postDto = (row: PostRow, role: Role | null): PostDto => ({
  id: row.id,
  board_id: row.board_id,
  section_id: row.section_id,
  position: row.state === 'published' ? row.position : null,
  title: row.title,
  body: row.body,
  author: { id: row.author_id, display_name: row.author_name },
  state: row.state === 'awaiting_approval' ? 'awaiting_approval' : 'published',
  likes: row.likes,
  score: row.score,
  comments: row.comments,
  liked: row.liked,
  my_vote: row.my_vote,
  attachment:
    row.attachment_id === null
      ? null
      : {
          id: row.attachment_id,
          file_name: row.file_name ?? 'file',
          content_type: row.content_type ?? 'application/octet-stream',
          size: row.size ?? 0,
          url: `/api/attachments/${row.attachment_id}`,
        },
  version: row.version,
  created_at: isoSeconds(row.created_at),
  push:
    row.state === 'awaiting_approval' && (role === 'moderator' || role === 'owner') ? (row.push_state ?? 'pending') : null,
});

const sortPosts = (rows: PostRow[], sort: SortMode): PostRow[] => {
  const copy = [...rows];
  const bySeq = (a: PostRow, b: PostRow): number => Number(BigInt(a.seq) - BigInt(b.seq));
  switch (sort) {
    case 'by_hand':
      return copy.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || bySeq(a, b));
    case 'newest':
      return copy.sort((a, b) => bySeq(b, a));
    case 'oldest':
      return copy.sort(bySeq);
    case 'most_liked':
      return copy.sort((a, b) => b.likes - a.likes || bySeq(a, b));
  }
};

/** The displayed arrangement: sections or author groups, each in the board's sort. */
export const displayedListing = (
  board: BoardRow,
  sections: SectionDto[],
  rows: PostRow[],
  role: Role | null,
  userId: string | null,
): PostsListing => {
  const visible = rows.filter((row) => canSeePost(row, role, userId));
  const published = visible.filter((row) => row.state === 'published');
  const held = visible.filter((row) => row.state === 'awaiting_approval');

  const groups: PostsListing['sections'] = [];
  if (board.grouping === 'author') {
    const byAuthor = new Map<string, { title: string; posts: PostRow[] }>();
    for (const row of published) {
      const group = byAuthor.get(row.author_id) ?? { title: row.author_name, posts: [] };
      group.posts.push(row);
      byAuthor.set(row.author_id, group);
    }
    const ordered = [...byAuthor.entries()].sort(([, a], [, b]) =>
      a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );
    for (const [authorId, group] of ordered) {
      const posts = sortPosts(group.posts, board.sort);
      groups.push({
        id: `author-${authorId}`,
        title: group.title,
        count: posts.length,
        posts: posts.map((row) => postDto(row, role)),
      });
    }
  } else {
    for (const section of sections) {
      const posts = sortPosts(
        published.filter((row) => row.section_id === section.id),
        board.sort,
      );
      groups.push({
        id: section.id,
        title: section.title,
        count: posts.length,
        posts: posts.map((row) => postDto(row, role)),
      });
    }
  }
  return {
    sections: groups,
    held: held.sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq))).map((row) => postDto(row, role)),
  };
};

export const publishedCount = async (db: Db, sectionId: string): Promise<number> => {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from posts where section_id = $1 and state = 'published'",
    [sectionId],
  );
  return result.rows[0].count;
};

export const loadSectionOfBoard = async (db: Db, boardId: string, sectionId: string): Promise<{ id: string; title: string }> => {
  if (!UUID_PATTERN.test(sectionId)) throw notFound();
  const result = await db.query<{ id: string; title: string }>(
    'select id, title from sections where id = $1 and board_id = $2',
    [sectionId, boardId],
  );
  const section = result.rows[0];
  if (section === undefined) throw notFound();
  return section;
};

/** Hand order: a new post lands last in its section. */
export const appendPosition = async (db: Db, sectionId: string): Promise<number> => (await publishedCount(db, sectionId)) + 1;

const closeGap = async (db: Db, sectionId: string, fromPosition: number): Promise<void> => {
  await db.query(
    `update posts set position = position - 1
     where section_id = $1 and state = 'published' and position > $2`,
    [sectionId, fromPosition],
  );
};

/** Hand order: insert at the target position, shifting the target section and closing the source gap. */
export const applyHandMove = async (
  db: Db,
  post: { id: string; section_id: string; position: number },
  targetSectionId: string,
  targetPosition: number,
): Promise<void> => {
  await db.query("update posts set position = null where id = $1", [post.id]);
  await closeGap(db, post.section_id, post.position);
  await db.query(
    `update posts set position = position + 1
     where section_id = $1 and state = 'published' and position >= $2`,
    [targetSectionId, targetPosition],
  );
  await db.query('update posts set section_id = $1, position = $2 where id = $3', [targetSectionId, targetPosition, post.id]);
};

export const removeFromHandOrder = async (db: Db, post: { section_id: string; position: number | null }): Promise<void> => {
  if (post.position === null) return;
  await closeGap(db, post.section_id, post.position);
};

export const maxTargetPosition = async (
  db: Db,
  post: { section_id: string; position: number },
  targetSectionId: string,
): Promise<number> => {
  const count = await publishedCount(db, targetSectionId);
  return targetSectionId === post.section_id ? count : count + 1;
};

/** Sort and grouping gates on a move, with the published refusal messages. */
export const moveGate = (board: BoardRow, post: { section_id: string }, targetSectionId: string): void => {
  if (board.grouping === 'author') throw invalid({ position: MOVE_COPY.groupBlocked() });
  if (board.sort !== 'by_hand' && targetSectionId === post.section_id) {
    throw invalid({ position: MOVE_COPY.sortBlocked(SORT_LABELS[board.sort]) });
  }
};

export const checkPositionRange = (position: number, max: number): void => {
  if (!Number.isInteger(position) || position < 1 || position > max) {
    throw invalid({ position: POSITION_COPY.outOfRange(max) });
  }
};

/** The one version check: a move or edit raises the version or loses to the writer who got there first. */
export const bumpVersion = async (
  db: Db,
  current: PostRow,
  expectedVersion: number,
  actorId: string,
  fields: { title: string; body: string } | null,
): Promise<void> => {
  const result =
    fields === null
      ? await db.query('update posts set version = version + 1, last_actor_id = $2 where id = $1 and version = $3', [
          current.id,
          actorId,
          expectedVersion,
        ])
      : await db.query(
          'update posts set title = $4, body = $5, version = version + 1, last_actor_id = $2 where id = $1 and version = $3',
          [current.id, actorId, expectedVersion, fields.title, fields.body],
        );
  if (result.rowCount === 0) {
    throw moveConflict(
      { section_id: current.section_id, position: current.position, version: current.version },
      current.last_actor_name,
    );
  }
};
