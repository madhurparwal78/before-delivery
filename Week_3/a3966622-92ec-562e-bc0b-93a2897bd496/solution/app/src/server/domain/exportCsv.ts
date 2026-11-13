// The moves export: standard CSV whose text cells can never run as spreadsheet formulas.
import type { MoveRecord, Store } from "../store.js";
import { pricedBy } from "./billing.js";
import { boardingInstant } from "./moveClock.js";

const HEADER = "ref,vessel,agency,status,boarding_at,pinch_waypoint,margin_mm,tariff_revision,total_cents";
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text cell: a leading `'` before formula starters, then RFC 4180 quoting where needed. */
function textCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Moves in rising boarding instant, ties by rising reference. */
export const inBoardingOrder = (a: MoveRecord, b: MoveRecord): number =>
  boardingInstant(a) - boardingInstant(b) || a.seq - b.seq;

export function movesCsv(store: Store, moves: MoveRecord[]): string {
  const rows = [...moves].sort(inBoardingOrder).map((move) => {
    const priced = pricedBy(store, move);
    return [
      textCell(move.ref),
      textCell(move.vessel.name),
      textCell(move.agency_code),
      textCell(move.status),
      textCell(move.boarding_at),
      textCell(move.committed?.pinch_waypoint ?? ""),
      move.committed ? String(move.committed.margin_mm) : "",
      textCell(priced.tariff_revision),
      String(priced.total_cents),
    ].join(",");
  });
  return [HEADER, ...rows].map((line) => `${line}\r\n`).join("");
}
