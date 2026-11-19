/** Who may see and change what. Role, ownership and authority always come from stored records. */
import { one, type Queryable, type Row } from "./db.js";
import { boatRow } from "./boats.js";
import { loadFact, type DrawingFacts } from "./drawings.js";
import { ownerDrawingCodes } from "./grants.js";
import { stockRow } from "./stock.js";
import { refuse } from "./errors.js";
import type { AccountRow } from "./accounts.js";
import type { Ctx } from "./http.js";
import type { Role } from "../shared/types.js";

/** 403 for a role that may not call the address at all. */
export function onlyRoles(ctx: Ctx, ...allowed: Role[]): void {
  if (!allowed.includes(ctx.actor.role)) throw refuse("forbidden");
}

export async function visibleBoat(db: Queryable, actor: AccountRow, code: string): Promise<Row | null> {
  const row = await boatRow(db, code);
  if (!row) return null;
  if (actor.role === "sailmaker") return row;
  if (actor.role === "yacht-owner") return row.owner_id === actor.id ? row : null;
  const assigned = await one(db, "SELECT 1 FROM drawing WHERE boat_code = $1 AND assigned_to = $2 LIMIT 1", [code, actor.id]);
  return assigned ? row : null;
}

/** The SQL that limits a boat list to what the caller may see. */
export function boatScope(actor: AccountRow): { clause: string; params: unknown[] } {
  if (actor.role === "sailmaker") return { clause: "TRUE", params: [] };
  if (actor.role === "yacht-owner") return { clause: "b.owner_id = $1", params: [actor.id] };
  return { clause: "EXISTS (SELECT 1 FROM drawing d WHERE d.boat_code = b.code AND d.assigned_to = $1)", params: [actor.id] };
}

export async function drawingScope(db: Queryable, actor: AccountRow, at: Date): Promise<{ clause: string; params: unknown[] }> {
  if (actor.role === "sailmaker") return { clause: "TRUE", params: [] };
  if (actor.role === "loft-hand") return { clause: "d.assigned_to = $1", params: [actor.id] };
  return { clause: "d.code = ANY($1)", params: [await ownerDrawingCodes(db, actor, at)] };
}

export async function visibleDrawing(db: Queryable, actor: AccountRow, code: string, at: Date): Promise<DrawingFacts | null> {
  const facts = await loadFact(db, code, at);
  if (!facts) return null;
  if (actor.role === "sailmaker") return facts;
  if (actor.role === "loft-hand") return facts.row.assigned_to === actor.id ? facts : null;
  return (await ownerDrawingCodes(db, actor, at)).includes(code) ? facts : null;
}

/** Stock a loft hand may see: the cloth of the drawings assigned to them. */
export async function visibleStock(db: Queryable, actor: AccountRow, code: string): Promise<Row | null> {
  const row = await stockRow(db, code);
  if (!row) return null;
  if (actor.role === "sailmaker") return row;
  if (actor.role !== "loft-hand") return null;
  const mine = await one(db, "SELECT 1 FROM drawing WHERE assigned_to = $1 AND cloth_code = $2 LIMIT 1", [actor.id, row.cloth_code]);
  return mine ? row : null;
}
