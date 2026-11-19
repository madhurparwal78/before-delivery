import type { Db } from "./db";
import type { UserRef } from "./domain";
import { canSeeBoard, roleOnBoard } from "./access";
import { pinsJson, type PinJson } from "./pinjson";

export interface BoardJson {
  id: number;
  name: string;
  visibility: "public" | "secret";
  owner: UserRef;
  role: "owner" | "editor" | "viewer" | null;
  seq: number;
  pin_count: number;
  followers: number;
  following: boolean;
  cover: number | null;
  created_at: string;
  last_saved_at: string | null;
  order: {
    unsectioned: number[];
    sections: { id: number; name: string; pins: number[] }[];
  };
  pins?: PinJson[];
}

export interface BoardOrder {
  unsectioned: number[];
  sections: { id: number; name: string; pins: number[] }[];
}

export async function boardOrder(db: Db, boardId: number): Promise<BoardOrder> {
  const sections = await db.query<{ id: string; name: string }>(
    `select id, name from sections where board_id = $1 order by position`,
    [boardId]
  );
  const pins = await db.query<{ id: string; section_id: string | null }>(
    `select id, section_id from pins where board_id = $1 and status = 'live' order by section_id nulls first, position`,
    [boardId]
  );
  const unsectioned = pins.filter(p => p.section_id === null).map(p => Number(p.id));
  const sectionPins = new Map<number, number[]>();
  for (const p of pins.filter(p => p.section_id !== null)) {
    const list = sectionPins.get(Number(p.section_id)) ?? [];
    list.push(Number(p.id));
    sectionPins.set(Number(p.section_id), list);
  }
  return {
    unsectioned,
    sections: sections.map(s => ({ id: Number(s.id), name: s.name, pins: sectionPins.get(Number(s.id)) ?? [] })),
  };
}

/** The cover rule (DP-47): the chosen pin while it is on the board, then position 1 of the
 * unsectioned area, then position 1 of the first section that has pins, else no cover. */
export async function boardCover(db: Db, board: { id: number; cover_pin_id: number | null }): Promise<number | null> {
  if (board.cover_pin_id !== null) {
    const chosen = await db.queryOne<{ id: string }>(
      `select id from pins where id = $1 and board_id = $2 and status = 'live'`,
      [board.cover_pin_id, board.id]
    );
    if (chosen) return Number(chosen.id);
  }
  const first = await db.queryOne<{ id: string }>(
    `select p.id from pins p
     where p.board_id = $1 and p.status = 'live' and p.section_id is null
     order by p.position limit 1`,
    [board.id]
  );
  if (first) return Number(first.id);
  const inSection = await db.queryOne<{ id: string }>(
    `select p.id from pins p
     join sections s on s.id = p.section_id and s.board_id = p.board_id
     where p.board_id = $1 and p.status = 'live'
     order by s.position, p.position limit 1`,
    [board.id]
  );
  return inSection ? Number(inSection.id) : null;
}

export async function boardFollowerCount(db: Db, boardId: number): Promise<number> {
  const row = await db.queryOne<{ n: string }>(`select count(*)::text as n from follows_boards where board_id = $1`, [boardId]);
  return Number(row?.n ?? 0);
}

export async function userFollowerCount(db: Db, userId: number): Promise<number> {
  const row = await db.queryOne<{ n: string }>(`select count(*)::text as n from follows_users where target_id = $1`, [userId]);
  return Number(row?.n ?? 0);
}

export async function userFollowingCount(db: Db, userId: number): Promise<number> {
  const row = await db.queryOne<{ n: string }>(
    `select ((select count(*) from follows_users where follower_id = $1)
          + (select count(*) from follows_boards fb join boards b on b.id = fb.board_id where fb.follower_id = $1 and b.visibility = 'public'))::text as n`,
    [userId]
  );
  return Number(row?.n ?? 0);
}

export async function boardPinCount(db: Db, boardId: number): Promise<number> {
  const row = await db.queryOne<{ n: string }>(
    `select count(*)::text as n from pins where board_id = $1 and status = 'live'`,
    [boardId]
  );
  return Number(row?.n ?? 0);
}

export async function boardJson(db: Db, viewer: UserRef | null, boardId: number, withPins = true): Promise<unknown> {
  const board = await db.queryOne<{
    id: string; owner_id: string; name: string; visibility: "public" | "secret";
    seq: string; cover_pin_id: string | null; last_saved_at: Date | null; created_at: Date;
    owner_name: string; owner_handle: string;
  }>(
    `select b.*, u.name as owner_name, u.handle as owner_handle from boards b join users u on u.id = b.owner_id where b.id = $1`,
    [boardId]
  );
  const seen = await canSeeBoard(db, viewer, boardId);
  if (!board || !seen) return null;
  const role = await roleOnBoard(db, viewer, boardId);
  const [order, cover, followers, pinCount] = await Promise.all([
    boardOrder(db, boardId),
    boardCover(db, { id: boardId, cover_pin_id: board.cover_pin_id === null ? null : Number(board.cover_pin_id) }),
    boardFollowerCount(db, boardId),
    boardPinCount(db, boardId),
  ]);
  let following = false;
  if (viewer) {
    const row = await db.queryOne<{ f: string }>(
      `select 1::text as f from follows_boards where board_id = $1 and follower_id = $2`,
      [boardId, viewer.id]
    );
    following = row !== null;
  }
  const json: Record<string, unknown> = {
    id: Number(board.id),
    name: board.name,
    visibility: board.visibility,
    owner: { id: Number(board.owner_id), name: board.owner_name, handle: board.owner_handle },
    role,
    seq: Number(board.seq),
    pin_count: pinCount,
    followers,
    following,
    cover,
    created_at: board.created_at.toISOString(),
    last_saved_at: board.last_saved_at ? board.last_saved_at.toISOString() : null,
    order,
  };
  if (withPins) {
    json.pins = await pinsJson(db, viewer, [...order.unsectioned, ...order.sections.flatMap(s => s.pins)]);
  }
  return json;
}
