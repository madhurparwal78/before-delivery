// Booking fees in integer cents: day or half-day rate, started quarter hours of overtime, usage lines, the
// 20% agency service fee split by the leftover-cent rule, and each tax line rounded on its own.

import type { OfficeId } from "../../shared/zones.js";
import { halfUp } from "../../shared/arith.js";

export type Board = "women" | "men" | "creators" | "new_faces";
export type Media = "digital" | "print" | "out_of_home" | "broadcast";
export type Territory = "canada" | "north_america" | "worldwide";
export type DayType = "full_day" | "half_day";

export const BOARDS: Board[] = ["women", "men", "creators", "new_faces"];
export const MEDIA: Record<Media, string> = { digital: "Digital", print: "Print", out_of_home: "Out of home",
  broadcast: "Broadcast" };
export const TERRITORIES: Record<Territory, string> = { canada: "Canada", north_america: "North America",
  worldwide: "Worldwide" };
const TERRITORY_PERCENT: Record<Territory, number> = { canada: 100, north_america: 150, worldwide: 250 };
const TERM_PERCENT: Record<number, number> = { 3: 50, 6: 75, 12: 100 };
export const USAGE_TERMS = [3, 6, 12];
export const MAX_OVERTIME_MINUTES = 600;
const SERVICE_PERCENT = 20;
const TAXES: Record<OfficeId, Array<{ label: string; percent: number }>> = {
  toronto: [{ label: "HST 13%", percent: 13 }],
  vancouver: [{ label: "GST 5%", percent: 5 }, { label: "PST 7%", percent: 7 }],
};

export function isMedia(value: unknown): value is Media {
  return typeof value === "string" && value in MEDIA;
}

export function isTerritory(value: unknown): value is Territory {
  return typeof value === "string" && value in TERRITORIES;
}

export function isBoard(value: unknown): value is Board {
  return typeof value === "string" && (BOARDS as string[]).includes(value);
}

export interface BoardRates {
  fullDayCents: number;
  halfDayCents: number;
  overtimeQuarterHourCents: number;
}

export interface RateCard {
  id: string;
  name: string;
  effectiveFrom: string;
  boards: Record<Board, BoardRates>;
  usageBaseCents: Record<Media, number>;
}

export interface UsageRow {
  media: Media;
  territory: Territory;
  termMonths: number;
}

export interface PricedTalent {
  talentId: string;
  displayName: string;
  board: Board;
  dayType: DayType;
  overtimeMinutes: number;
  usage: UsageRow[];
}

export interface FeeLine {
  kind: "day_rate" | "half_day_rate" | "overtime" | "usage" | "service_fee" | "tax";
  label: string;
  talentId: string | null;
  amountCents: number;
}

export interface Priced {
  lines: FeeLine[];
  talent: Array<{ talentId: string; talentFeesCents: number; serviceFeeShareCents: number }>;
  talentFeesCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
}

/** Shares rounded down, leftover cents one at a time to the largest dropped fraction, ties to the earlier index. */
function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights.map((w, i) => ({ i, rest: (total * w) % sum }));
  const leftover = total - shares.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; k < leftover; k++) shares[remainders[k].i] += 1;
  return shares;
}

function usageAmount(card: RateCard, row: UsageRow): number {
  return halfUp(card.usageBaseCents[row.media] * TERRITORY_PERCENT[row.territory] * TERM_PERCENT[row.termMonths], 10_000);
}

/** Every fee line of a confirm, priced by `card` for a group in `office`. */
export function price(card: RateCard, office: OfficeId, group: PricedTalent[]): Priced {
  const lines: FeeLine[] = [];
  const fees: number[] = [];
  for (const row of group) {
    const rates = card.boards[row.board];
    const quarters = Math.ceil(row.overtimeMinutes / 15);
    const day: FeeLine = row.dayType === "full_day"
      ? { kind: "day_rate", label: `Day rate: ${row.displayName}`, talentId: row.talentId, amountCents: rates.fullDayCents }
      : { kind: "half_day_rate", label: `Half-day rate: ${row.displayName}`, talentId: row.talentId,
        amountCents: rates.halfDayCents };
    const candidates: FeeLine[] = [
      day,
      { kind: "overtime", label: `Overtime: ${row.displayName}, ${quarters} quarter hours`, talentId: row.talentId,
        amountCents: quarters * rates.overtimeQuarterHourCents },
      ...row.usage.map((usage): FeeLine => ({
        kind: "usage",
        label: `Usage: ${row.displayName}, ${MEDIA[usage.media]}, ${TERRITORIES[usage.territory]}, ${usage.termMonths} months`,
        talentId: row.talentId,
        amountCents: usageAmount(card, usage),
      })),
    ];
    const own = candidates.filter((line) => line.amountCents !== 0);
    lines.push(...own);
    fees.push(own.reduce((sum, line) => sum + line.amountCents, 0));
  }
  const talentFeesCents = fees.reduce((a, b) => a + b, 0);
  const serviceFeeCents = halfUp(talentFeesCents * SERVICE_PERCENT, 100);
  const shares = splitByWeight(serviceFeeCents, fees);
  lines.push({ kind: "service_fee", label: `Agency service fee ${SERVICE_PERCENT}%`, talentId: null, amountCents: serviceFeeCents });
  let taxCents = 0;
  for (const tax of TAXES[office]) {
    const amount = halfUp((talentFeesCents + serviceFeeCents) * tax.percent, 100);
    taxCents += amount;
    lines.push({ kind: "tax", label: tax.label, talentId: null, amountCents: amount });
  }
  return {
    lines,
    talent: group.map((row, i) => ({ talentId: row.talentId, talentFeesCents: fees[i], serviceFeeShareCents: shares[i] })),
    talentFeesCents,
    serviceFeeCents,
    taxCents,
    totalCents: talentFeesCents + serviceFeeCents + taxCents,
  };
}
