import { createHash } from 'node:crypto';
import { fail, failValidation } from '../errors.js';
import { divFloor } from '../money.js';
import {
  SLOTS,
  type BoardName,
  type BoardPackage,
  type Component,
  type Slot,
  boardPackage,
  boardPackageName,
  component,
  componentInSlot,
  fitsBoard,
} from './catalog.js';
import { financingFor, type FinancingTerm } from './financing.js';

export const BUILD_KEYS: readonly string[] = [
  'board_sku',
  'wing',
  'mast',
  'propulsion',
  'battery',
  'controller',
  'spares',
  'rider_kg',
  'gear',
] as const;

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

export interface BuildSlotShape {
  sku: string;
  name: string;
  delta_cents: number;
}

export interface BuildShape {
  code: string;
  board_sku: string;
  board_name: string;
  slots: Record<Slot, BuildSlotShape>;
  spares: number;
  rider_kg: number;
  gear: number;
  total_cents: number;
  ride_min: number;
  total_ride_min: number;
  battery_bars: number;
  financing: FinancingTerm[];
}

function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function incompatibleMessage(board: BoardName): string {
  return `Not compatible with ${board}.`;
}

export function buildCode(picks: BuildPicks): string {
  const canonical = [
    picks.board_sku,
    picks.wing,
    picks.mast,
    picks.propulsion,
    picks.battery,
    picks.controller,
    picks.spares,
    picks.rider_kg,
    picks.gear,
  ].join('|');
  return `B-${createHash('sha256').update(canonical, 'utf8').digest('hex').toUpperCase().slice(0, 10)}`;
}

/** Build check 0: the body accepts exactly the nine pick keys. */
export function rejectUnknownBuildKeys(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((key) => !BUILD_KEYS.includes(key));
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const key of unknown) fields[key] = 'Unknown field.';
    fail('unknown_field', { fields });
  }
}

/** Build checks 1 to 6, in their published order. */
export function resolvePicks(body: Record<string, unknown>): { picks: BuildPicks; pkg: BoardPackage; parts: Record<Slot, Component> } {
  const pkg = boardPackage(body.board_sku);
  if (!pkg) fail('unknown_board', { fields: { board_sku: 'Unknown board.' } });

  const parts = {} as Record<Slot, Component>;
  for (const slot of SLOTS) {
    const part = componentInSlot(slot, body[slot]);
    if (!part) fail('unknown_component', { fields: { [slot]: 'Unknown part.' } });
    parts[slot] = part;
  }

  for (const slot of SLOTS) {
    const part = parts[slot];
    if (!fitsBoard(part, pkg.board)) {
      fail('incompatible', { message: incompatibleMessage(pkg.board), fields: { [slot]: incompatibleMessage(pkg.board) } });
    }
  }

  const { spares, rider_kg: riderKg, gear } = body;
  if (!isJsonInteger(spares) || spares < 0 || spares > 2) {
    failValidation({ spares: 'Choose 0, 1 or 2 spare batteries.' });
  }
  if (!isJsonInteger(riderKg) || riderKg < 50 || riderKg > 120 || riderKg % 5 !== 0) {
    failValidation({ rider_kg: 'Choose a rider weight from 50 to 120 kg in steps of 5.' });
  }
  if (!isJsonInteger(gear) || gear < 1 || gear > 10) {
    failValidation({ gear: 'Choose a gear from 1 to 10.' });
  }

  return {
    picks: {
      board_sku: pkg.sku,
      wing: parts.wing.sku,
      mast: parts.mast.sku,
      propulsion: parts.propulsion.sku,
      battery: parts.battery.sku,
      controller: parts.controller.sku,
      spares,
      rider_kg: riderKg,
      gear,
    },
    pkg,
    parts,
  };
}

function slotDelta(pkg: BoardPackage, slot: Slot, chosen: Component): number {
  const fallback = component(pkg.defaults[slot]);
  if (!fallback) throw new Error(`Missing default ${slot} for ${pkg.sku}`);
  return Math.max(0, chosen.priceCents - fallback.priceCents);
}

export function priceBuild(pkg: BoardPackage, parts: Record<Slot, Component>, spares: number): number {
  let total = pkg.priceCents;
  for (const slot of SLOTS) total += slotDelta(pkg, slot, parts[slot]);
  return total + spares * parts.battery.priceCents;
}

export function rideMinutes(wing: Component, battery: Component, riderKg: number, gear: number): number {
  const drawW = BigInt(wing.drawAtGear1 ?? 0) + BigInt(gear - 1) * BigInt(wing.addedPerGear ?? 0);
  const weightFactor = 1000n + 4n * BigInt(Math.max(0, riderKg - 80));
  const numerator = BigInt(battery.wh ?? 0) * 60n * 1000n;
  const denominator = drawW * weightFactor;
  return 5 * Number(divFloor(numerator, 5n * denominator));
}

export function batteryBars(totalRideMin: number): number {
  return Math.min(4, 1 + Math.floor(totalRideMin / 90));
}

export function buildShape(pkg: BoardPackage, parts: Record<Slot, Component>, picks: BuildPicks): BuildShape {
  const totalCents = priceBuild(pkg, parts, picks.spares);
  const rideMin = rideMinutes(parts.wing, parts.battery, picks.rider_kg, picks.gear);
  const totalRideMin = rideMin * (1 + picks.spares);
  const slots = {} as Record<Slot, BuildSlotShape>;
  for (const slot of SLOTS) {
    slots[slot] = { sku: parts[slot].sku, name: parts[slot].name, delta_cents: slotDelta(pkg, slot, parts[slot]) };
  }
  return {
    code: buildCode(picks),
    board_sku: pkg.sku,
    board_name: boardPackageName(pkg),
    slots,
    spares: picks.spares,
    rider_kg: picks.rider_kg,
    gear: picks.gear,
    total_cents: totalCents,
    ride_min: rideMin,
    total_ride_min: totalRideMin,
    battery_bars: batteryBars(totalRideMin),
    financing: financingFor(totalCents),
  };
}

export function defaultPicks(boardSku: string, riderKg = 80, gear = 5): BuildPicks {
  const pkg = boardPackage(boardSku);
  if (!pkg) throw new Error(`Unknown board ${boardSku}`);
  return {
    board_sku: pkg.sku,
    wing: pkg.defaults.wing,
    mast: pkg.defaults.mast,
    propulsion: pkg.defaults.propulsion,
    battery: pkg.defaults.battery,
    controller: pkg.defaults.controller,
    spares: 0,
    rider_kg: riderKg,
    gear,
  };
}
