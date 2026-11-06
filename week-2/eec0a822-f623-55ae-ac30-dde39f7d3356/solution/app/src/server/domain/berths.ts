// Berth fit, nightly tariffs and shore-power slot status (brief: Berths, Shore power).
import { rows, type Db } from "../db";
import { roundHalfUp } from "../../shared/money";
import { addDays, startOfLocalDay, type Base } from "../../shared/zones";

export interface BerthRow {
  code: string;
  length_cm: number;
  width_cm: number;
  depth_cm: number;
}

const UNDER_KEEL_CM = 30;

/** A berth fits when length, beam and draft + 0.30 m are at most its length, width and depth; equal fits. */
export function berthFits(yacht: { length_cm: number; beam_cm: number; draft_cm: number }, berth: BerthRow): boolean {
  return yacht.length_cm <= berth.length_cm && yacht.beam_cm <= berth.width_cm && yacht.draft_cm + UNDER_KEEL_CM <= berth.depth_cm;
}

interface TariffRow {
  id: string;
  effective_date: string;
  rate_per_metre_minor: number;
}

export interface Night {
  date: string;
  tariffId: string;
  ratePerMetreMinor: number;
  feeMinor: number;
}

export async function tariffsOf(db: Db, workspace: string, marinaId: string): Promise<TariffRow[]> {
  return rows<TariffRow>(db, "SELECT id, effective_date, rate_per_metre_minor FROM tariffs WHERE workspace_slug = $1 AND marina_id = $2 ORDER BY effective_date",
    [workspace, marinaId]);
}

/** Each night priced from the tariff in force on its local date, times the length, half up to the cent. */
export function priceNights(tariffs: TariffRow[], lengthCm: number, arrival: string, nights: number): Night[] {
  return Array.from({ length: nights }, (_, i) => {
    const date = addDays(arrival, i);
    const tariff = [...tariffs].reverse().find((t) => t.effective_date <= date)!;
    return {
      date,
      tariffId: tariff.id,
      ratePerMetreMinor: tariff.rate_per_metre_minor,
      feeMinor: Number(roundHalfUp(BigInt(lengthCm) * BigInt(tariff.rate_per_metre_minor), 100n)),
    };
  });
}

export const SLOT_MS = 30 * 60 * 1000;
const FULL_BELOW_KW = 22;

type SlotStatus = "open" | "full" | "past";

/** Past from its start instant on; full when fewer than 22 kW remain; open otherwise. */
export function slotStatus(startMs: number, nowMs: number, limitKw: number, bookedKw: number): SlotStatus {
  if (startMs <= nowMs) return "past";
  return limitKw - bookedKw < FULL_BELOW_KW ? "full" : "open";
}

/** The half-hour slots of a local date at a marina. */
export function daySlots(date: string, base: Base): number[] {
  const start = startOfLocalDay(date, base);
  const end = startOfLocalDay(addDays(date, 1), base);
  const out: number[] = [];
  for (let ms = start; ms < end; ms += SLOT_MS) out.push(ms);
  return out;
}

