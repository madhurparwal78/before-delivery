import type { Db } from './db.js';
import type { BoardRow, PostRow, SectionRow, AttachmentRow } from './types.js';
import type { PostDTO, SectionDTO, BoardDTO, PostsDTO, Role, Sort } from '../shared/types.js';
import { dbAll } from './queries.js';
import { csvTimestamp } from './rules.js';

export interface PostExtras {
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  myVote: number;
  authorName: string;
  attachment: AttachmentRow | null;
}

const emptyExtras = (): PostExtras => ({ likes: 0, score: 0, comments: 0, liked: false, myVote: 0, authorName: '', attachment: null });

export async function loadPostExtras(db: Db, postIds: string[], userId: string | null): Promise<Map<string, PostExtras>> {
  const map = new Map<string, PostExtras>();
  if (postIds.length === 0) return map;
  const reactionRows = await db.query(
    `SELECT post_id,
            count(*) FILTER (WHERE kind = 'like') AS likes,
            count(*) FILTER (WHERE kind = 'vote' AND value = 1) AS up_votes,
            count(*) FILTER (WHERE kind = 'vote' AND value = -1) AS down_votes
       FROM (
         SELECT post_id, 'like' AS kind, 0 AS value FROM likes WHERE post_id = ANY($1::text[])
         UNION ALL
         SELECT post_id, 'vote' AS kind, value FROM votes WHERE post_id = ANY($1::text[])
       ) reactions
      GROUP BY post_id`,
    [postIds],
  );
  const commentRows = await db.query(
    `SELECT post_id, count(*) AS n FROM comments WHERE post_id = ANY($1::text[]) GROUP BY post_id`,
    [postIds],
  );
  const authorRows = await db.query(
    `SELECT p.id AS post_id, u.display_name
       FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.id = ANY($1::text[])`,
    [postIds],
  );
  const attachmentRows = await db.query(`SELECT * FROM attachments WHERE post_id = ANY($1::text[])`, [postIds]);
  const mineRows = userId
    ? await db.query(`SELECT post_id FROM likes WHERE post_id = ANY($1::text[]) AND user_id = $2`, [postIds, userId])
    : null;
  const myVoteRows = userId
    ? await db.query(`SELECT post_id, value FROM votes WHERE post_id = ANY($1::text[]) AND user_id = $2`, [postIds, userId])
    : null;
  const likesMine = new Set((mineRows?.rows ?? []).map((r) => (r as { post_id: string }).post_id));
  const votesMine = new Map<string, number>();
  for (const row of myVoteRows?.rows ?? []) {
    const r = row as { post_id: string; value: number };
    votesMine.set(r.post_id, r.value);
  }
  for (const row of reactionRows.rows) {
    const r = row as { post_id: string; likes: string; up_votes: string; down_votes: string };
    map.set(r.post_id, {
      ...emptyExtras(),
      likes: Number(r.likes),
      score: Number(r.up_votes) - Number(r.down_votes),
      liked: likesMine.has(r.post_id),
      myVote: votesMine.get(r.post_id) ?? 0,
    });
  }
  for (const row of commentRows.rows) {
    const r = row as { post_id: string; n: string };
    const entry = map.get(r.post_id) ?? emptyExtras();
    entry.comments = Number(r.n);
    map.set(r.post_id, entry);
  }
  for (const row of authorRows.rows) {
    const r = row as { post_id: string; display_name: string };
    const entry = map.get(r.post_id) ?? emptyExtras();
    entry.authorName = r.display_name;
    map.set(r.post_id, entry);
  }
  for (const row of attachmentRows.rows) {
    const a = row as AttachmentRow;
    const entry = map.get(a.post_id) ?? emptyExtras();
    entry.attachment = a;
    map.set(a.post_id, entry);
  }
  for (const id of postIds) {
    if (!map.has(id)) map.set(id, emptyExtras());
  }
  return map;
}

export function toPostDTO(post: PostRow, extras: PostExtras, push: 'sent' | 'pending' | null): PostDTO {
  return {
    id: post.id,
    board_id: post.board_id,
    section_id: post.section_id,
    position: post.state === 'awaiting_approval' ? null : post.position,
    title: post.title,
    body: post.body,
    author: { id: post.author_id, display_name: extras.authorName },
    state: post.state === 'awaiting_approval' ? 'awaiting_approval' : 'published',
    likes: extras.likes,
    score: extras.score,
    comments: extras.comments,
    liked: extras.liked,
    my_vote: extras.myVote,
    attachment: extras.attachment
      ? {
          id: extras.attachment.id,
          file_name: extras.attachment.file_name,
          content_type: extras.attachment.content_type,
          size: extras.attachment.size,
          url: `/api/attachments/${extras.attachment.id}`,
        }
      : null,
    version: post.version,
    created_at: csvTimestamp(post.created_at),
    push,
  };
}

export async function listSections(db: Db, boardId: string): Promise<SectionRow[]> {
  const rows = await dbAll<SectionRow>(db, 'SELECT * FROM sections WHERE board_id = $1 ORDER BY position', [boardId]);
  return rows;
}

export async function boardPostsListing(
  db: Db,
  board: BoardRow,
  userId: string | null,
  viewerRole: Role | null,
): Promise<PostsDTO> {
  const sections = await listSections(db, board.id);
  const published = await dbAll<PostRow>(
    db,
    'SELECT * FROM posts WHERE board_id = $1 AND state = $2 ORDER BY created_at',
    [board.id, 'published'],
  );
  const heldRows = await dbAll<PostRow>(
    db,
    'SELECT * FROM posts WHERE board_id = $1 AND state = $2 ORDER BY created_at',
    [board.id, 'awaiting_approval'],
  );
  const ids = [...published, ...heldRows].map((p) => p.id);
  const extras = await loadPostExtras(db, ids, userId);
  const canSeeHeld = roleAtLeast(viewerRole, 'moderator');
  const visibleHeld = heldRows.filter((p) => canSeeHeld || p.author_id === userId);

  const postDtos = new Map<string, PostDTO>();
  for (const p of published) {
    postDtos.set(p.id, toPostDTO(p, extras.get(p.id)!, null));
  }

  const sectionsOut: SectionDTO[] = [];
  if (board.group === 'author') {
    const byAuthor = new Map<string, PostRow[]>();
    for (const p of published) {
      const list = byAuthor.get(p.author_id) ?? [];
      list.push(p);
      byAuthor.set(p.author_id, list);
    }
    const authorIds = [...byAuthor.keys()].sort((a, b) => {
      const na = extras.get(byAuthor.get(a)![0]!.id)?.authorName ?? a;
      const nb = extras.get(byAuthor.get(b)![0]!.id)?.authorName ?? b;
      return na.localeCompare(nb, 'en', { sensitivity: 'base' });
    });
    for (const authorId of authorIds) {
      const posts = byAuthor.get(authorId)!;
      const ordered = posts.slice().sort((a, b) => sortOrder(board.sort)(a, b, extras));
      const authorName = extras.get(ordered[0]!.id)?.authorName ?? '';
      sectionsOut.push({
        id: `author-${authorId}`,
        title: authorName,
        count: ordered.length,
        posts: ordered.map((p) => postDtos.get(p.id)!),
      });
    }
  } else {
    for (const section of sections) {
      const inSection = published.filter((p) => p.section_id === section.id);
      const ordered = inSection.slice().sort((a, b) => sortOrder(board.sort)(a, b, extras));
      sectionsOut.push({
        id: section.id,
        title: section.title,
        count: ordered.length,
        posts: ordered.map((p) => postDtos.get(p.id)!),
      });
    }
  }

  const heldOut = visibleHeld.map((p) => {
    const pushState = canSeeHeld ? (p.push_state as 'sent' | 'pending') : null;
    return toPostDTO(p, extras.get(p.id)!, pushState);
  });

  return { sections: sectionsOut, held: heldOut };
}

export function sortOrder(sort: Sort): (a: PostRow, b: PostRow, extras: Map<string, PostExtras>) => number {
  if (sort === 'newest') return (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
  if (sort === 'oldest') return (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
  if (sort === 'most_liked') {
    return (a, b, extras) => {
      const la = extras.get(a.id)?.likes ?? 0;
      const lb = extras.get(b.id)?.likes ?? 0;
      if (la !== lb) return lb - la;
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    };
  }
  return (a, b) => (a.position ?? 0) - (b.position ?? 0);
}

export function roleAtLeast(role: Role | null, floor: Role): boolean {
  if (!role) return false;
  const order: Role[] = ['viewer', 'contributor', 'moderator', 'owner'];
  return order.indexOf(role) >= order.indexOf(floor);
}

export async function boardCounts(db: Db, boardId: string): Promise<Map<string, number>> {
  const rows = await db.query(
    'SELECT section_id, count(*) AS n FROM posts WHERE board_id = $1 AND state = $2 GROUP BY section_id',
    [boardId, 'published'],
  );
  const map = new Map<string, number>();
  for (const row of rows.rows) {
    const r = row as { section_id: string; n: string };
    map.set(r.section_id, Number(r.n));
  }
  return map;
}

export async function toBoardDTO(db: Db, board: BoardRow, role: Role | null, includeLinkPaths: boolean): Promise<BoardDTO> {
  const sections = await listSections(db, board.id);
  const counts = await boardCounts(db, board.id);
  const linkLive = board.link_token !== null && board.privacy !== 'private' && board.link_access !== 'off';
  const sharePath = linkLive ? `/s/${board.link_token}` : null;
  const embedPath = linkLive && board.privacy === 'public' ? `/embed/${board.link_token}` : null;
  return {
    id: board.id,
    title: board.title,
    layout: board.layout,
    sort: board.sort,
    group: board.group,
    privacy: board.privacy,
    approval: board.approval,
    link_access: board.link_access,
    role,
    sections: sections.map((s) => ({ id: s.id, title: s.title, count: counts.get(s.id) ?? 0 })),
    share_path: includeLinkPaths ? sharePath : null,
    embed_path: includeLinkPaths ? embedPath : null,
  };
}
