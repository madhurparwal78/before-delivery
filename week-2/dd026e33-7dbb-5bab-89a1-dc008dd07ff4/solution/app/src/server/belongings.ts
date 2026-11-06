// Belongings ledger (brief: Business rules › Belongings): count_in is always the sum of movements,
// never stored; every movement takes hold of its car first (one change at a time per car).
import type { Item, Movement } from "../shared/api.js";
import { ITEM_KINDS, type ItemKind, type Role } from "../shared/domain.js";
import { requireRole } from "./auth.js";
import { many, newId, one, type Db } from "./db.js";
import { conflict, FieldErrors, notFound } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { presentActor, type Viewer } from "./projection.js";
import { visibleCar } from "./cars.js";

const ITEM_SELECT = `
  SELECT i.id, i.car_id, i.kind, i.label,
         coalesce(sum(CASE m.direction WHEN 'in' THEN m.count ELSE -m.count END), 0)::int AS count_in
    FROM items i LEFT JOIN movements m ON m.item_id = i.id`;

interface ItemRow {
  [key: string]: unknown;
  id: string;
  car_id: string;
  kind: ItemKind;
  label: string;
  count_in: number;
}

function presentItem(row: ItemRow): Item {
  return { id: row.id, kind: row.kind, label: row.label, count_in: row.count_in };
}

export async function belongingsOf(db: Db, carId: string): Promise<Item[]> {
  const rows = await many<ItemRow>(db, `${ITEM_SELECT} WHERE i.car_id = $1 GROUP BY i.id ORDER BY i.created_at, i.id`, [carId]);
  return rows.map(presentItem);
}

/** Items of the car still checked in (count_in above zero). */
export async function checkedInItems(db: Db, carId: string): Promise<Item[]> {
  return (await belongingsOf(db, carId)).filter((item) => item.count_in > 0);
}

async function item(db: Db, id: string): Promise<ItemRow> {
  const row = await one<ItemRow>(db, `${ITEM_SELECT} WHERE i.id = $1 GROUP BY i.id`, [id]);
  if (!row) throw notFound();
  return row;
}

async function visibleItem(db: Db, viewer: Viewer, id: string): Promise<ItemRow> {
  const row = await item(db, id);
  await visibleCar(db, viewer, row.car_id);
  return row;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

interface MovementRow {
  [key: string]: unknown;
  id: string;
  direction: "in" | "out";
  count: number;
  at: Date;
  by_id: string;
  by_name: string;
  by_role: Role;
}

function presentMovement(viewer: Viewer, row: MovementRow): Movement {
  return {
    id: row.id,
    direction: row.direction,
    count: row.count,
    at: row.at.toISOString(),
    by: presentActor(viewer, { id: row.by_id, name: row.by_name, role: row.by_role }),
  };
}

async function recordMovement(db: Db, itemId: string, direction: "in" | "out", amount: number, byId: string): Promise<MovementRow> {
  const id = newId("m");
  await db.query("INSERT INTO movements (id, item_id, direction, count, at, by_id) VALUES ($1, $2, $3, $4, clock_timestamp(), $5)", [
    id,
    itemId,
    direction,
    amount,
    byId,
  ]);
  const row = await one<MovementRow>(
    db,
    "SELECT m.*, u.name AS by_name, u.role AS by_role FROM movements m JOIN users u ON u.id = m.by_id WHERE m.id = $1",
    [id],
  );
  if (!row) throw new Error("movement vanished");
  return row;
}

export async function addItem(ctx: Ctx): Promise<Reply> {
  const carId = ctx.params.id ?? "";
  await visibleCar(ctx.db, ctx.user, carId);
  requireRole(ctx.user, "concierge", "house_manager");
  const car = await visibleCar(ctx.db, ctx.user, carId, true);
  if (car.status === "released") throw conflict("car_released");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const kind = ITEM_KINDS.find((k) => k === body.kind);
  if (!kind) errors.add("kind", "Choose an item kind from the list.");
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length < 1 || label.length > 60) errors.add("label", "Enter 1 to 60 characters.");
  const amount = count(body.count);
  if (amount === null || amount < 0 || amount > 20) errors.add("count", "Enter a whole number from 0 to 20.");
  errors.throwIfAny();

  const id = newId("b");
  await ctx.db.query("INSERT INTO items (id, car_id, kind, label) VALUES ($1, $2, $3, $4)", [id, car.id, kind, label]);
  await recordMovement(ctx.db, id, "in", amount ?? 0, ctx.user.id);
  return { status: 201, body: { item: presentItem(await item(ctx.db, id)) } };
}

export async function moveItem(ctx: Ctx): Promise<Reply> {
  const found = await visibleItem(ctx.db, ctx.user, ctx.params.id ?? "");
  requireRole(ctx.user, "concierge", "house_manager");
  const car = await visibleCar(ctx.db, ctx.user, found.car_id, true);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const direction = body.direction === "in" || body.direction === "out" ? body.direction : null;
  const amount = count(body.count);
  if (car.status === "released") throw conflict("car_released");
  const current = await item(ctx.db, found.id);
  if (direction === "out" && amount !== null && amount >= 1 && amount > current.count_in) throw conflict("insufficient_items");

  const errors = new FieldErrors();
  if (!direction) errors.add("direction", "Choose in or out.");
  if (amount === null || amount < 1 || amount > 20) errors.add("count", "Enter a whole number from 1 to 20.");
  errors.throwIfAny();

  const movement = await recordMovement(ctx.db, current.id, direction ?? "in", amount ?? 0, ctx.user.id);
  return { status: 201, body: { item: presentItem(await item(ctx.db, current.id)), movement: presentMovement(ctx.user, movement) } };
}

export async function listMovements(ctx: Ctx): Promise<Reply> {
  const found = await visibleItem(ctx.db, ctx.user, ctx.params.id ?? "");
  const rows = await many<MovementRow>(
    ctx.db,
    "SELECT m.*, u.name AS by_name, u.role AS by_role FROM movements m JOIN users u ON u.id = m.by_id WHERE m.item_id = $1 ORDER BY m.at, m.id",
    [found.id],
  );
  return { status: 200, body: { movements: rows.map((r) => presentMovement(ctx.user, r)) } };
}
