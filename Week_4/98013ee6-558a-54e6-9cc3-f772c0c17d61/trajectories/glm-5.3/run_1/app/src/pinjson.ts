import type { Db } from "./db";
import type { UserRef } from "./domain";
import { canSeeBoard } from "./access";

export interface PinJson {
  id: number;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  source_host: string | null;
  tags: string[];
  owner: UserRef;
  board: { id: number; name: string; visibility: "public" | "secret" };
  section: { id: number; name: string } | null;
  position: number;
  image: {
    width: number;
    height: number;
    sha256: string;
    variants: { width: number; url: string }[];
    original_url: string;
  };
  saved_from: { pin_id: number | null; user_name: string; removed: boolean } | null;
  saves: number;
  comments: number;
  reactions: number;
  my_reaction: "love" | "idea" | "wow" | "thanks" | null;
  created_at: string;
}

interface PinRow {
  id: string; version: number; title: string; description: string; alt: string;
  source: string | null; source_host: string | null; tags: string[]; position: number;
  owner_id: string; board_id: string; section_id: string | null; image_id: string;
  root_id: string | null; created_at: Date;
  owner_name: string; owner_handle: string;
  board_name: string; board_visibility: "public" | "secret"; board_owner_id: string;
  image_width: number; image_height: number; image_sha: string;
  section_name: string | null;
}

const PIN_SELECT = `
  select p.id, p.version, p.title, p.description, p.alt, p.source, p.source_host, p.tags,
         p.position, p.owner_id, p.board_id, p.section_id, p.image_id, p.root_id, p.created_at,
         u.name as owner_name, u.handle as owner_handle,
         b.name as board_name, b.visibility as board_visibility, b.owner_id as board_owner_id,
         i.width as image_width, i.height as image_height, i.sha256 as image_sha,
         s.name as section_name
  from pins p
  join users u on u.id = p.owner_id
  join boards b on b.id = p.board_id
  join images i on i.id = p.image_id
  left join sections s on s.id = p.section_id
`;

export type SaveCounts = Map<number, { saves: number; comments: number; reactions: number; mine: string | null }>;

/** Loads counts for a set of pins in one query each. */
export async function pinCounts(db: Db, viewer: UserRef | null, pinIds: number[]): Promise<SaveCounts> {
  const result: SaveCounts = new Map();
  if (pinIds.length === 0) return result;
  const saves = await db.query<{ root_id: string; n: string }>(
    `select s.root_id, count(*)::text as n from pins s
     where s.root_id = any($1) and s.status = 'live'
       and exists (select 1 from boards b where b.id = s.board_id and b.visibility = 'public')
     group by s.root_id`,
    [pinIds]
  );
  const saveCount = new Map(saves.map(r => [Number(r.root_id), Number(r.n)]));
  const comments = await db.query<{ pin_id: string; n: string }>(
    `select pin_id, count(*)::text as n from comments where pin_id = any($1) and deleted = false group by pin_id`,
    [pinIds]
  );
  const commentCount = new Map(comments.map(r => [Number(r.pin_id), Number(r.n)]));
  const reactions = await db.query<{ pin_id: string; n: string }>(
    `select pin_id, count(*)::text as n from reactions where pin_id = any($1) group by pin_id`,
    [pinIds]
  );
  const reactionCount = new Map(reactions.map(r => [Number(r.pin_id), Number(r.n)]));
  let mine = new Map<number, string>();
  if (viewer) {
    const rows = await db.query<{ pin_id: string; type: string }>(
      `select pin_id, type from reactions where user_id = $1 and pin_id = any($2)`,
      [viewer.id, pinIds]
    );
    mine = new Map(rows.map(r => [Number(r.pin_id), r.type]));
  }
  for (const id of pinIds) {
    result.set(id, {
      saves: saveCount.get(id) ?? 0,
      comments: commentCount.get(id) ?? 0,
      reactions: reactionCount.get(id) ?? 0,
      mine: mine.get(id) ?? null,
    });
  }
  return result;
}

/** The credit-line rule, decided in one place (DP-32, DP-35). */
export function creditFor(
  rootInfo: { pinId: number; ownerName: string; status: string; boardId: number; boardVisible: boolean } | null
): { pin_id: number | null; user_name: string; removed: boolean } | null {
  if (!rootInfo) return null;
  // 1. The viewer may not see the original's board: plain credit, no link, no removed flag.
  if (!rootInfo.boardVisible) return { pin_id: null, user_name: rootInfo.ownerName, removed: false };
  // 2. The original is deleted (in its window or gone): removed credit with no link.
  if (rootInfo.status !== "live") return { pin_id: null, user_name: rootInfo.ownerName, removed: true };
  // 3. Otherwise a link to the live original.
  return { pin_id: rootInfo.pinId, user_name: rootInfo.ownerName, removed: false };
}

export async function pinJson(db: Db, viewer: UserRef | null, pinId: number): Promise<PinJson> {
  const [json] = await pinsJson(db, viewer, [pinId]);
  return json!;
}

export async function pinsJson(db: Db, viewer: UserRef | null, pinIds: number[]): Promise<PinJson[]> {
  if (pinIds.length === 0) return [];
  const rows = await db.query<PinRow>(
    `${PIN_SELECT} where p.id = any($1) and p.status = 'live' order by p.id`,
    [pinIds]
  );
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const counts = await pinCounts(db, viewer, pinIds);
  const out: PinJson[] = [];
  for (const id of pinIds) {
    const row = byId.get(id);
    if (!row) continue;
    out.push(await rowToJson(db, viewer, row, counts));
  }
  return out;
}

async function rowToJson(db: Db, viewer: UserRef | null, row: PinRow, counts: SaveCounts): Promise<PinJson> {
  const pinId = Number(row.id);
  let savedFrom: PinJson["saved_from"] = null;
  if (row.root_id !== null) {
    const rootId = Number(row.root_id);
    const root = await db.queryOne<{ id: string; status: string; owner_name: string; board_id: string }>(
      `select p.id, p.status, u.name as owner_name, p.board_id
       from pins p join users u on u.id = p.owner_id where p.id = $1`,
      [rootId]
    );
    if (root) {
      const visible = await canSeeBoard(db, viewer, Number(root.board_id));
      savedFrom = creditFor({
        pinId: rootId,
        ownerName: root.owner_name,
        status: root.status,
        boardId: Number(root.board_id),
        boardVisible: visible,
      });
    }
  }
  const count = counts.get(pinId) ?? { saves: 0, comments: 0, reactions: 0, mine: null };
  const variants = [];
  for (const w of [236, 474, 736]) {
    if (w <= row.image_width) variants.push({ width: w, url: `/media/${pinId}/${w}` });
  }
  return {
    id: pinId,
    version: row.version,
    title: row.title,
    description: row.description,
    alt: row.alt,
    source: row.source,
    source_host: row.source_host,
    tags: row.tags ?? [],
    owner: { id: Number(row.owner_id), name: row.owner_name, handle: row.owner_handle },
    board: { id: Number(row.board_id), name: row.board_name, visibility: row.board_visibility },
    section: row.section_id !== null ? { id: Number(row.section_id), name: row.section_name! } : null,
    position: row.position,
    image: {
      width: row.image_width,
      height: row.image_height,
      sha256: row.image_sha,
      variants,
      original_url: `/media/${pinId}/original`,
    },
    saved_from: savedFrom,
    saves: count.saves,
    comments: count.comments,
    reactions: count.reactions,
    my_reaction: count.mine as PinJson["my_reaction"],
    created_at: row.created_at.toISOString(),
  };
}
