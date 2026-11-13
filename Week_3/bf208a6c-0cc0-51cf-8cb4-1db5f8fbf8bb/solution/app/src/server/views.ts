import { embedApplies, linkApplies, type BoardRow, type Open } from "./access";
import { one, rows, type Db } from "./db";
import { sortPosts } from "../shared/order";
import { may } from "../shared/permissions";
import type { Board, Listing, ListingSection, Post, PostState, Role, SectionSummary } from "../shared/types";

const iso = (value: Date): string => value.toISOString();

interface PostRow {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  state: PostState;
  version: number;
  created_at: Date;
  push: "sent" | "pending" | null;
  file_card: boolean;
  author_id: string;
  author_name: string;
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  my_vote: number | null;
  attachment_id: string | null;
  file_name: string | null;
  content_type: string | null;
  size: number | null;
}

/** Likes, scores and comment counts are always derived from the stored rows. */
const POST_QUERY = `
  SELECT p.id, p.board_id, p.section_id, p.position, p.title, p.body, p.state, p.version, p.created_at, p.push, p.file_card,
         u.id AS author_id, u.display_name AS author_name,
         (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS likes,
         (SELECT coalesce(sum(v.value), 0) FROM votes v WHERE v.post_id = p.id) AS score,
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id) AS comments,
         EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked,
         (SELECT v.value FROM votes v WHERE v.post_id = p.id AND v.user_id = $1) AS my_vote,
         a.id AS attachment_id, a.file_name, a.content_type, a.size
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN attachments a ON a.post_id = p.id`;

function postOf(row: PostRow, staff: boolean): Post {
  return {
    id: row.id,
    board_id: row.board_id,
    section_id: row.section_id,
    position: row.state === "published" ? row.position : null,
    title: row.title,
    body: row.body,
    author: { id: row.author_id, display_name: row.author_name },
    state: row.state,
    likes: row.likes,
    score: row.score,
    comments: row.comments,
    liked: row.liked,
    my_vote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : 0,
    attachment:
      row.attachment_id && row.file_name && row.content_type && row.size !== null
        ? { id: row.attachment_id, file_name: row.file_name, content_type: row.content_type, size: row.size, url: `/api/attachments/${row.attachment_id}` }
        : null,
    file_card: row.file_card,
    version: row.version,
    created_at: iso(row.created_at),
    push: row.state === "awaiting_approval" && staff ? row.push : null,
  };
}

export async function loadPost(db: Db, postId: string, access: Open): Promise<Post> {
  const row = await one<PostRow>(db, `${POST_QUERY} WHERE p.id = $2`, [access.caller.user?.id ?? null, postId]);
  return postOf(row, may("moderate", access.role, null));
}

async function loadSections(db: Db, boardId: string): Promise<SectionSummary[]> {
  return rows<SectionSummary>(
    db,
    `SELECT s.id, s.title, (SELECT count(*) FROM posts p WHERE p.section_id = s.id AND p.state = 'published') AS count
     FROM sections s WHERE s.board_id = $1 ORDER BY s.ordinal`,
    [boardId],
  );
}

export async function boardOf(db: Db, board: BoardRow, role: Role | null): Promise<Board> {
  const owner = role === "owner";
  return {
    id: board.id,
    title: board.title,
    layout: board.layout,
    sort: board.sort,
    group: board.grouping,
    privacy: board.privacy,
    approval: board.approval,
    link_access: board.link_access,
    role,
    sections: await loadSections(db, board.id),
    share_path: owner && linkApplies(board) ? `/s/${board.link_token}` : null,
    embed_path: owner && embedApplies(board) ? `/embed/${board.link_token}` : null,
  };
}

/** The displayed arrangement of a board: sections (or author groups A to Z), each in the current sort, plus the caller's held posts. */
export async function listingOf(db: Db, board: BoardRow, role: Role | null, viewerId: string | null): Promise<Listing> {
  const staff = may("moderate", role, null);
  const [sections, all] = await Promise.all([
    rows<{ id: string; title: string; ordinal: number }>(db, `SELECT id, title, ordinal FROM sections WHERE board_id = $1 ORDER BY ordinal`, [board.id]),
    rows<PostRow>(db, `${POST_QUERY} WHERE p.board_id = $2 ORDER BY p.seq`, [viewerId, board.id]),
  ]);
  const posts = all.map((row) => postOf(row, staff));
  const published = posts.filter((post) => post.state === "published");
  const held = posts.filter((post) => post.state === "awaiting_approval" && (staff || post.author.id === viewerId));
  const groups: ListingSection[] =
    board.grouping === "section"
      ? sections.map((section) => {
          const own = published.filter((post) => post.section_id === section.id);
          return { id: section.id, title: section.title, count: own.length, posts: sortPosts(own, board.sort) };
        })
      : authorGroups(published, sections, board);
  return { sections: groups, held };
}

function authorGroups(published: Post[], sections: { id: string; ordinal: number }[], board: BoardRow): ListingSection[] {
  const ordinal: Record<string, number> = Object.fromEntries(sections.map((section) => [section.id, section.ordinal]));
  const byAuthor = new Map<string, Post[]>();
  for (const post of published) byAuthor.set(post.author.id, [...(byAuthor.get(post.author.id) ?? []), post]);
  return [...byAuthor.values()]
    .map((own) => {
      const handOrder = [...own].sort((a, b) => ordinal[a.section_id] - ordinal[b.section_id] || (a.position ?? 0) - (b.position ?? 0));
      const ordered = board.sort === "by_hand" ? handOrder : sortPosts(own, board.sort);
      const author = own[0].author;
      return { id: `author-${author.id}`, title: author.display_name, count: own.length, posts: ordered };
    })
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || (a.id < b.id ? -1 : 1));
}
