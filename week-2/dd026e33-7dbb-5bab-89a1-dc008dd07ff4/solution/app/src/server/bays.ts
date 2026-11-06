// Bays (brief: Business rules › Bays): the fit rule with its clearance, one car per bay, moves within
// the bay class. bayRefusal is the one place a bay's eligibility for a car is decided.
import type { Bay } from "../shared/api.js";
import { carName, type BayClass } from "../shared/domain.js";
import { requireRole, requireStaff } from "./auth.js";
import { many, one, type Db } from "./db.js";
import { conflict, FieldErrors, notFound } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { presentCar, visibleCar, type CarRow } from "./cars.js";
import { enqueueSubscriptionCreate, PLAN_OF_CLASS } from "./queue.js";

export const CLEARANCE_MM = 500;

interface BayRow {
  [key: string]: unknown;
  id: string;
  code: string;
  class: BayClass;
  length_mm: number;
  width_mm: number;
  row_no: number;
  column_no: number;
  car_id: string | null;
  car_year: number | null;
  car_make: string | null;
  car_model: string | null;
}

const BAY_SELECT = `
  SELECT b.*, c.id AS car_id, c.year AS car_year, c.make AS car_make, c.model AS car_model
    FROM bays b LEFT JOIN cars c ON c.bay_id = b.id`;

type BayReason = "occupied" | "class_change" | "too_small";

/** Why a bay cannot take this car, in the published reason order, or null when it can. */
function bayRefusal(
  bay: { class: BayClass; length_mm: number; width_mm: number; car_id: string | null },
  car: Pick<CarRow, "status" | "bay_class" | "length_mm" | "width_mm">,
): BayReason | null {
  if (bay.car_id !== null) return "occupied";
  if (car.status === "stored" && car.bay_class !== bay.class) return "class_change";
  if (car.length_mm + CLEARANCE_MM > bay.length_mm || car.width_mm + CLEARANCE_MM > bay.width_mm) return "too_small";
  return null;
}

function presentBay(row: BayRow): Bay {
  return {
    id: row.id,
    code: row.code,
    class: row.class,
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    row: row.row_no,
    column: row.column_no,
    car: row.car_id ? { id: row.car_id, name: carName({ year: row.car_year ?? 0, make: row.car_make ?? "", model: row.car_model ?? "" }) } : null,
  };
}

export async function allBays(db: Db): Promise<Bay[]> {
  const rows = await many<BayRow>(db, `${BAY_SELECT} ORDER BY b.row_no, b.column_no`);
  return rows.map(presentBay);
}

export async function listBays(ctx: Ctx): Promise<Reply> {
  const fitsId = ctx.query.get("fits");
  const car = fitsId ? await visibleCar(ctx.db, ctx.user, fitsId) : null;
  requireStaff(ctx.user);
  const rows = await many<BayRow>(ctx.db, `${BAY_SELECT} ORDER BY b.row_no, b.column_no`);
  const bays = rows.map((row) => {
    const bay = presentBay(row);
    if (!car) return bay;
    const reason = bayRefusal(row, car);
    return { ...bay, eligible: reason === null, reason };
  });
  return { status: 200, body: { bays } };
}

const REFUSAL_CODE = { occupied: "bay_occupied", class_change: "bay_class_change", too_small: "bay_too_small" } as const;

export async function assignBay(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const carId = ctx.params.id ?? "";
  await visibleCar(ctx.db, ctx.user, carId);
  const bayId = typeof body.bay_id === "string" ? body.bay_id : null;
  if (bayId !== null && !(await one(ctx.db, "SELECT 1 FROM bays WHERE id = $1", [bayId]))) throw notFound();
  requireRole(ctx.user, "concierge", "house_manager");

  // One change at a time per car, then one car per bay.
  const car = await visibleCar(ctx.db, ctx.user, carId, true);
  if (car.status === "released") throw conflict("car_released");
  const errors = new FieldErrors();
  if (bayId === null) {
    errors.add("bay_id", "Choose a bay from the floor plan.");
    errors.throwIfAny();
  }
  await ctx.db.query("SELECT 1 FROM bays WHERE id = $1 FOR UPDATE", [bayId]);
  const bay = await one<BayRow>(ctx.db, `${BAY_SELECT} WHERE b.id = $1`, [bayId]);
  if (!bay) throw notFound();
  const reason = bayRefusal(bay, car);
  if (reason) throw conflict(REFUSAL_CODE[reason]);

  if (car.status === "awaiting_intake") {
    await ctx.db.query(
      `UPDATE cars SET bay_id = $2, status = 'stored', intake_at = clock_timestamp(), billing_status = 'pending', billing_plan = $3
        WHERE id = $1`,
      [car.id, bay.id, PLAN_OF_CLASS[bay.class]],
    );
    await enqueueSubscriptionCreate(ctx.db, car.id);
  } else {
    await ctx.db.query("UPDATE cars SET bay_id = $2 WHERE id = $1", [car.id, bay.id]);
  }
  const updated = await visibleCar(ctx.db, ctx.user, car.id);
  return { status: 200, body: { car: presentCar(ctx.user, updated) } };
}
