import { notFound } from "../http/errors.ts";
import type { Ctx } from "../http/router.ts";
import { one } from "../db/pool.ts";
import type { Language, Town } from "../domain/towns.ts";

export interface PieceRow {
  id: string;
  desk_id: string;
  client_id: string;
  title: string;
  maker: string | null;
  year: string | null;
  stamp_number: string | null;
  width_cm: string | null;
  depth_cm: string | null;
  height_cm: string | null;
  weight_kg: string | null;
  due_date: string | null;
  notes: string | null;
  state: string;
  last_pin_number: number;
  client_name: string;
  client_town: Town;
  client_language: Language;
  client_email: string | null;
  client_state: string;
}

const PIECE_SELECT = `SELECT p.*, c.name AS client_name, c.town AS client_town, c.language AS client_language,
  c.email AS client_email, c.state AS client_state
  FROM pieces p JOIN clients c ON c.id = p.client_id`;

/** A piece of this desk, whose client has not reached `erasing`; anything else is 404. */
export async function findPiece(deskId: string, pieceId: string): Promise<PieceRow | null> {
  return one<PieceRow>(`${PIECE_SELECT} WHERE p.id = $1 AND p.desk_id = $2 AND c.state NOT IN ('erasing', 'erased')`, [pieceId, deskId]);
}

/** The `resource` step of every route under /api/pieces/:id. */
export async function pieceResource(ctx: Ctx): Promise<void> {
  const piece = await findPiece(ctx.deskId, ctx.params.id as string);
  if (!piece) throw notFound();
  ctx.loaded.piece = piece;
}

export function pieceOf(ctx: Ctx): PieceRow {
  return ctx.loaded.piece as PieceRow;
}
