// Builds (brief: Builds): the checks in their published order, price, exact ride time, battery bars and code.
import { createHash } from "node:crypto";
import { SLOTS, type BoardPackage, type Catalog, type Component, type Slot } from "../catalog.ts";
import type { Db } from "../db.ts";
import { ApiError, invalid, refuseUnknown, unknownFields, type Fields } from "../errors.ts";
import { now } from "../clock.ts";
import { idiv } from "../money.ts";
import { financing, type FinancingTerm } from "./financing.ts";

const PICK_KEYS = ["board_sku", ...SLOTS, "spares", "rider_kg", "gear"] as const;
const BASE_RIDER_KG = 80;

export interface BuildPicks {
  board_sku: string;
  wing: string;
  mast: string;
  propulsion: string;
  battery: string;
  controller: string;
  spares: number;
  rider_kg: number;
  gear: number;
}

export interface Build {
  code: string;
  board_sku: string;
  board_name: string;
  slots: Record<Slot, { sku: string; name: string; delta_cents: number }>;
  spares: number;
  rider_kg: number;
  gear: number;
  total_cents: number;
  ride_min: number;
  total_ride_min: number;
  battery_bars: number;
  financing: FinancingTerm[];
}

function isIntegerIn(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
}

/** Runs checks 0 to 7 of Builds in order; the first failure answers. */
export function checkPicks(body: Record<string, unknown>, catalog: Catalog): BuildPicks {
  const unknown = refuseUnknown(body, PICK_KEYS);
  if (Object.keys(unknown).length) throw unknownFields(unknown);
  const board = typeof body.board_sku === "string" ? catalog.board(body.board_sku) : undefined;
  if (!board) throw new ApiError("unknown_board", { fields: { board_sku: "Unknown board." } });
  const parts: Partial<Record<Slot, Component>> = {};
  const unknownParts: Fields = {};
  for (const slot of SLOTS) {
    const value = body[slot];
    const part = typeof value === "string" ? catalog.component(value) : undefined;
    if (part && part.slot === slot) parts[slot] = part;
    else unknownParts[slot] = "Unknown part.";
  }
  if (Object.keys(unknownParts).length) throw new ApiError("unknown_component", { fields: unknownParts });
  const message = `Not compatible with ${board.name}.`;
  const incompatible: Fields = {};
  for (const slot of SLOTS) if (!parts[slot]?.fits.includes(board.name)) incompatible[slot] = message;
  if (Object.keys(incompatible).length) throw new ApiError("incompatible", { message, fields: incompatible });
  const { spares, rider_kg, gear } = body;
  if (!isIntegerIn(spares, 0, 2)) throw invalid({ spares: "Choose 0, 1 or 2 spare batteries." });
  if (!isIntegerIn(rider_kg, 50, 120) || rider_kg % 5 !== 0) {
    throw invalid({ rider_kg: "Choose a rider weight from 50 to 120 kg in steps of 5." });
  }
  if (!isIntegerIn(gear, 1, 10)) throw invalid({ gear: "Choose a gear from 1 to 10." });
  if (board.stock === 0) throw new ApiError("out_of_stock", { status: 422 });
  return {
    board_sku: board.sku,
    wing: body.wing as string,
    mast: body.mast as string,
    propulsion: body.propulsion as string,
    battery: body.battery as string,
    controller: body.controller as string,
    spares,
    rider_kg,
    gear,
  };
}

/**
 * ride_min = 5 × floor(wh × 60 × 1000 / (draw_w × (1000 + 4 × max(0, rider_kg − 80))) / 5), one exact integer
 * division, with draw_w = draw at gear 1 + (gear − 1) × added per gear.
 */
function rideMinutes(wing: Component, battery: Component, riderKg: number, gear: number): number {
  const [atGearOne, perGear] = wing.draw_w as [number, number];
  const draw = atGearOne + (gear - 1) * perGear;
  const load = 1000 + 4 * Math.max(0, riderKg - BASE_RIDER_KG);
  return 5 * idiv((battery.wh as number) * 60 * 1000, draw * load * 5);
}

function batteryBars(totalRideMin: number): number {
  return Math.min(4, 1 + idiv(totalRideMin, 90));
}

function buildCode(picks: BuildPicks): string {
  const canonical = [picks.board_sku, ...SLOTS.map((s) => picks[s]), picks.spares, picks.rider_kg, picks.gear].join("|");
  return `B-${createHash("sha256").update(canonical).digest("hex").toUpperCase().slice(0, 10)}`;
}

/** A slot's price delta: what the chosen part costs over the board's default; a cheaper part adds nothing. */
export function slotDelta(chosen: { price_cents: number }, standard: { price_cents: number }): number {
  return Math.max(0, chosen.price_cents - standard.price_cents);
}

/** Prices and times picks that already passed the checks. */
export function priceBuild(picks: BuildPicks, catalog: Catalog): Build {
  const board = catalog.board(picks.board_sku) as BoardPackage;
  const part = (sku: string) => catalog.component(sku) as Component;
  const slots = {} as Build["slots"];
  let total = board.price_cents;
  for (const slot of SLOTS) {
    const chosen = part(picks[slot]);
    const delta = slotDelta(chosen, part(board.defaults[slot]));
    slots[slot] = { sku: chosen.sku, name: chosen.name, delta_cents: delta };
    total += delta;
  }
  const battery = part(picks.battery);
  total += picks.spares * battery.price_cents;
  const ride = rideMinutes(part(picks.wing), battery, picks.rider_kg, picks.gear);
  const totalRide = ride * (1 + picks.spares);
  return {
    code: buildCode(picks),
    board_sku: board.sku,
    board_name: board.name,
    slots,
    spares: picks.spares,
    rider_kg: picks.rider_kg,
    gear: picks.gear,
    total_cents: total,
    ride_min: ride,
    total_ride_min: totalRide,
    battery_bars: batteryBars(totalRide),
    financing: financing(total, null),
  };
}

/** Saves a build; true when it was new. */
export async function saveBuild(db: Db, picks: BuildPicks): Promise<boolean> {
  const { rowCount } = await db.query(
    "INSERT INTO builds (code, picks, created_at) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING",
    [buildCode(picks), JSON.stringify(picks), now()],
  );
  return rowCount === 1;
}

export async function savedPicks(db: Db, code: string): Promise<BuildPicks | null> {
  const { rows } = await db.query<{ picks: BuildPicks }>("SELECT picks FROM builds WHERE code = $1", [code]);
  return rows[0]?.picks ?? null;
}

export function buildNotFound(): ApiError {
  return new ApiError("not_found", { message: "We could not find that build." });
}

/** `<board> <size> build <code>`, the line name of a build. */
export function buildLineName(picks: BuildPicks, catalog: Catalog): string {
  const board = catalog.board(picks.board_sku) as BoardPackage;
  return `${board.name} ${board.size} build ${buildCode(picks)}`;
}
