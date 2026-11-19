import type { Db } from "./db";
import type { UserRef } from "./domain";
import { notFound } from "./errors";

/**
 * Board visibility to a viewer: decided in exactly one place (DP-61, DP-62).
 * A board is visible to its owner and members; to anyone if public; never otherwise.
 */
export async function canSeeBoard(db: Db, viewer: UserRef | null, boardId: number): Promise<boolean> {
  const board = await db.queryOne<{ owner_id: string; visibility: "public" | "secret" }>(
    `select owner_id, visibility from boards where id = $1`,
    [boardId]
  );
  if (!board) return false;
  if (board.visibility === "public") return true;
  if (!viewer) return false;
  if (board.owner_id === String(viewer.id)) return true;
  const member = await db.queryOne<{ role: string }>(
    `select role from board_members where board_id = $1 and user_id = $2`,
    [boardId, viewer.id]
  );
  return member !== null;
}

/** The viewer's role on a board: "owner", "editor", "viewer" or null. */
export async function roleOnBoard(db: Db, viewer: UserRef | null, boardId: number): Promise<"owner" | "editor" | "viewer" | null> {
  if (!viewer) return null;
  const board = await db.queryOne<{ owner_id: string }>(`select owner_id from boards where id = $1`, [boardId]);
  if (!board) return null;
  if (board.owner_id === String(viewer.id)) return "owner";
  const member = await db.queryOne<{ role: "editor" | "viewer" }>(
    `select role from board_members where board_id = $1 and user_id = $2`,
    [boardId, viewer.id]
  );
  return member?.role ?? null;
}

/** Loads a pin the viewer may see, or answers exactly like a record that never existed (DP-62). */
export async function visiblePin(db: Db, viewer: UserRef | null, pinId: number) {
  const pin = await db.queryOne<{
    id: string; owner_id: string; board_id: string; section_id: string | null;
    image_id: string; root_id: string | null; version: number;
    title: string; description: string; alt: string; source: string | null;
    source_host: string | null; tags: string[]; position: number;
    status: "draft" | "live" | "deleted" | "gone";
    created_at: Date; updated_at: Date;
  }>(`select * from pins where id = $1 and status = 'live'`, [pinId]);
  if (!pin) throw notFound();
  const seen = await canSeeBoard(db, viewer, Number(pin.board_id));
  if (!seen) throw notFound();
  return pin;
}

/** Board or not found, never 403 for a hidden record. */
export async function boardOrNotFound(db: Db, viewer: UserRef | null, boardId: number) {
  const board = await db.queryOne<{
    id: string; owner_id: string; name: string; visibility: "public" | "secret";
    seq: string; cover_pin_id: string | null; last_saved_at: Date | null; created_at: Date;
  }>(`select * from boards where id = $1`, [boardId]);
  if (!board) throw notFound();
  const seen = await canSeeBoard(db, viewer, boardId);
  if (!seen) throw notFound();
  return board;
}
