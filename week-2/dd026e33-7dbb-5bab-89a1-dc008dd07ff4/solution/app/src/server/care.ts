// The care round and care entries (brief: Business rules › Care entries and flags).
import type { CareRoundRow } from "../shared/api.js";
import { carName, FLAG_LABEL, type FlagCode } from "../shared/domain.js";
import { parseDecimal, toScaled } from "../shared/decimal.js";
import { pressureToCentibar } from "../shared/units.js";
import { formatDay } from "../shared/zurich.js";
import { requireRole, requireStaff } from "./auth.js";
import { many, newId, one, type Db } from "./db.js";
import { conflict, FieldErrors } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { CAR_SELECT, ENTRY_SELECT, presentEntry, startupStatus, visibleCar, type CarRow, type EntryRow } from "./cars.js";

const LOW_BATTERY_CENTIVOLTS = 1240;
const TYRE_TOLERANCE_CENTIBAR = 20;

/** The care round: stored cars, overdue first, each group by bay code. */
export async function careRound(db: Db): Promise<{ row: CarRow; round: Omit<CareRoundRow, "last_entry">; lastEntry: EntryRow | null }[]> {
  const cars = await many<CarRow>(db, `${CAR_SELECT} WHERE c.status = 'stored' ORDER BY b.code`);
  const entries = await many<EntryRow>(
    db,
    `${ENTRY_SELECT} WHERE e.id IN (SELECT DISTINCT ON (car_id) id FROM care_entries ORDER BY car_id, at DESC, id DESC)`,
  );
  const now = new Date();
  const rows = cars.map((row) => ({
    row,
    round: { car: { id: row.id, name: carName(row) }, bay_code: row.bay_code ?? "", startup: startupStatus(row, now) },
    lastEntry: entries.find((e) => e.car_id === row.id) ?? null,
  }));
  return [...rows.filter((r) => r.round.startup.status === "overdue"), ...rows.filter((r) => r.round.startup.status !== "overdue")];
}

export async function getCareRound(ctx: Ctx): Promise<Reply> {
  requireStaff(ctx.user);
  const rows = await careRound(ctx.db);
  return {
    status: 200,
    body: { cars: rows.map((r) => ({ ...r.round, last_entry: r.lastEntry ? presentEntry(ctx.user, r.lastEntry) : null })) },
  };
}

function scaledInput(value: unknown, places: number): bigint | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text === null || text === "") return null;
  const parsed = parseDecimal(text);
  return parsed && parsed.num >= 0n ? toScaled(parsed, places) : null;
}

export async function addCareEntry(ctx: Ctx): Promise<Reply> {
  const carId = ctx.params.id ?? "";
  await visibleCar(ctx.db, ctx.user, carId);
  requireRole(ctx.user, "care_technician", "house_manager");
  const car = await visibleCar(ctx.db, ctx.user, carId, true);
  if (car.status !== "stored") throw conflict("car_not_stored");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const started = body.started === true;
  let battery: number | null = null;
  if (body.battery_v !== null && body.battery_v !== undefined && body.battery_v !== "") {
    const centivolts = scaledInput(body.battery_v, 2);
    if (centivolts === null || centivolts > 1600n) errors.add("battery_v", "Enter a voltage from 0.00 to 16.00 V.");
    else battery = Number(centivolts);
  }
  let tyres: Record<"fl" | "fr" | "rl" | "rr", number> | null = null;
  if (body.tyres !== null && body.tyres !== undefined) {
    const raw = body.tyres as Record<string, unknown>;
    const unit = raw.unit === "psi" ? "psi" : raw.unit === "bar" ? "bar" : null;
    const values = (["fl", "fr", "rl", "rr"] as const).map((wheel) => {
      const v = raw[wheel];
      const text = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
      return unit && text !== "" ? pressureToCentibar(text, unit) : null;
    });
    if (values.some((v) => v === null || v < 50 || v > 500)) errors.add("tyres", "Enter all four tyres from 0.50 to 5.00 bar.");
    else tyres = { fl: values[0] ?? 0, fr: values[1] ?? 0, rl: values[2] ?? 0, rr: values[3] ?? 0 };
  }
  const note = typeof body.note === "string" ? body.note : "";
  if (note.length >= 500) errors.add("note", "Keep the note under 500 characters.");
  if (!started && battery === null && tyres === null && !errors.has("battery_v") && !errors.has("tyres")) errors.add("entry", "Record a start-up, a battery voltage or tyre pressures.");
  if (!ctx.idempotencyKey) errors.add("idempotency_key", "Send an Idempotency-Key header.");
  errors.throwIfAny();

  const flags: FlagCode[] = [];
  if (battery !== null && battery < LOW_BATTERY_CENTIVOLTS) flags.push("battery_low");
  if (tyres && Object.values(tyres).some((t) => Math.abs(t - car.tyre_spec_centibar) > TYRE_TOLERANCE_CENTIBAR)) flags.push("tyre_pressure");

  const id = newId("e");
  await ctx.db.query(
    `INSERT INTO care_entries (id, car_id, at, by_id, started, battery_centivolts, tyre_fl, tyre_fr, tyre_rl, tyre_rr, note, flags)
     VALUES ($1, $2, clock_timestamp(), $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, car.id, ctx.user.id, started, battery, tyres?.fl ?? null, tyres?.fr ?? null, tyres?.rl ?? null, tyres?.rr ?? null, note, flags],
  );
  const entry = await one<EntryRow>(ctx.db, `${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  const after = await visibleCar(ctx.db, ctx.user, car.id);
  if (!entry) throw new Error("care entry vanished");
  const startup = startupStatus(after);
  const name = carName(car);
  let message = started && startup.next_due ? `Start-up logged for ${name}. Next start-up due ${formatDay(startup.next_due)}.` : `Round entry saved for ${name}.`;
  if (flags.length > 0) message += ` Flagged: ${flags.map((f) => FLAG_LABEL[f]).join(", ")}.`;
  return { status: 201, body: { entry: presentEntry(ctx.user, entry), startup, message } };
}

