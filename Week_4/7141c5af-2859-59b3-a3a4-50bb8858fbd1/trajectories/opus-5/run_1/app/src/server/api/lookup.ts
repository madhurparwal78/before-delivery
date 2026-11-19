/**
 * Desk-scoped lookups. Every id in a path or a published id field passes
 * through here, so another desk's id answers 404 and never 422.
 */
import type { Ctx } from '../http/context.ts';
import { fail } from '../http/errors.ts';
import type { Row } from '../present.ts';

const ID = /^\d+$/;

function asId(value: string): string {
  if (!ID.test(value)) throw fail.notFound();
  return value;
}

/** A client of this desk. Records from `erasing` on are gone. */
export async function findClient(ctx: Ctx, id: string): Promise<Row> {
  const desk = ctx.requireDesk();
  const row = await ctx.app.db.one<Row>(
    `SELECT * FROM clients WHERE id = $1 AND desk_id = $2 AND state IN ('active','closing')`,
    [asId(id), desk.id],
  );
  if (!row) throw fail.notFound();
  return row;
}

/** A client of this desk whatever its state, for the closing journey. */
export async function findClientAnyState(ctx: Ctx, id: string): Promise<Row> {
  const desk = ctx.requireDesk();
  const row = await ctx.app.db.one<Row>(
    `SELECT * FROM clients WHERE id = $1 AND desk_id = $2`,
    [asId(id), desk.id],
  );
  if (!row || row.state === 'erasing' || row.state === 'erased') throw fail.notFound();
  return row;
}

/** A piece of this desk, with its client's town and language. */
export async function findPiece(ctx: Ctx, id: string): Promise<Row> {
  const desk = ctx.requireDesk();
  const row = await ctx.app.db.one<Row>(
    `SELECT p.*, c.name AS client_name, c.town, c.language, c.email AS client_email,
            c.state AS client_state
       FROM pieces p JOIN clients c ON c.id = p.client_id
      WHERE p.id = $1 AND p.desk_id = $2 AND c.state IN ('active','closing')`,
    [asId(id), desk.id],
  );
  if (!row) throw fail.notFound();
  return row;
}

/** The piece named by a route's `:id`, stashed for the handler. */
export async function resolvePiece(ctx: Ctx): Promise<void> {
  ctx.resolved.piece = await findPiece(ctx, ctx.param('id'));
}

export async function resolveClient(ctx: Ctx): Promise<void> {
  ctx.resolved.client = await findClient(ctx, ctx.param('id'));
}

export function piece(ctx: Ctx): Row {
  const row = ctx.resolved.piece;
  if (!row) throw fail.notFound();
  return row;
}

export function client(ctx: Ctx): Row {
  const row = ctx.resolved.client;
  if (!row) throw fail.notFound();
  return row;
}

/** A published id field in a body, which must belong to this desk. */
export async function requireOwnClient(ctx: Ctx, clientId: unknown): Promise<Row> {
  if (typeof clientId !== 'string' && typeof clientId !== 'number') throw fail.notFound();
  return findClient(ctx, String(clientId));
}

export async function requireOwnPiece(ctx: Ctx, pieceId: unknown): Promise<Row> {
  if (typeof pieceId !== 'string' && typeof pieceId !== 'number') throw fail.notFound();
  return findPiece(ctx, String(pieceId));
}

export async function materialOf(ctx: Ctx, code: string): Promise<Row | null> {
  const desk = ctx.requireDesk();
  return ctx.app.db.one<Row>(`SELECT * FROM materials WHERE desk_id = $1 AND code = $2`, [
    desk.id,
    code,
  ]);
}
