import { can, type Action } from "../shared/roles.js";
import { forbidden, notFound } from "./errors.js";
import { one, type Db } from "./db.js";
import type { Role, Visibility } from "../shared/types.js";

/**
 * The single place that decides who may see a board and what a role may do.
 * `viewer` is the SQL parameter placeholder (for example "$1") holding the viewer's user id.
 */
export function visibleBoardSql(board: string, viewer: string): string {
  return `(${board}.visibility = 'public' OR ${board}.owner_id = ${viewer} OR EXISTS (SELECT 1 FROM board_members vm WHERE vm.board_id = ${board}.id AND vm.user_id = ${viewer}))`;
}

/** A live pin on a board the viewer may see. */
export function visiblePinSql(pin: string, board: string, viewer: string): string {
  return `(${pin}.state = 'live' AND ${board}.id IS NOT NULL AND ${visibleBoardSql(board, viewer)})`;
}

interface BoardAccess {
  id: number;
  name: string;
  visibility: Visibility;
  ownerId: number;
  seq: number;
  coverPinId: number | null;
  role: Role | null;
}

interface AccessRow {
  id: number;
  name: string;
  visibility: Visibility;
  owner_id: number;
  seq: number;
  cover_pin_id: number | null;
  role: Role | null;
}

/** Loads a board the viewer may see; anything else is "not found", exactly like a board that never existed. */
export async function loadBoard(db: Db, boardId: number, viewerId: number, lock = false): Promise<BoardAccess> {
  const row = await one<AccessRow>(
    db,
    `SELECT b.id, b.name, b.visibility, b.owner_id, b.seq, b.cover_pin_id,
            CASE WHEN b.owner_id = $2 THEN 'owner' ELSE (SELECT m.role FROM board_members m WHERE m.board_id = b.id AND m.user_id = $2) END AS role
       FROM boards b WHERE b.id = $1 AND ${visibleBoardSql("b", "$2")}${lock ? " FOR UPDATE OF b" : ""}`,
    [boardId, viewerId],
  );
  if (!row) throw notFound();
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    ownerId: row.owner_id,
    seq: row.seq,
    coverPinId: row.cover_pin_id,
    role: row.role,
  };
}

export function authorize(access: BoardAccess, action: Action): void {
  if (!can(access.role, action)) throw forbidden();
}

export async function canSeeBoard(db: Db, boardId: number, viewerId: number): Promise<boolean> {
  const row = await one(db, `SELECT 1 FROM boards b WHERE b.id = $1 AND ${visibleBoardSql("b", "$2")}`, [boardId, viewerId]);
  return row !== null;
}

export async function canSeePin(db: Db, pinId: number, viewerId: number): Promise<boolean> {
  const row = await one(
    db,
    `SELECT 1 FROM pins p LEFT JOIN boards b ON b.id = p.board_id WHERE p.id = $1 AND ${visiblePinSql("p", "b", "$2")}`,
    [pinId, viewerId],
  );
  return row !== null;
}
