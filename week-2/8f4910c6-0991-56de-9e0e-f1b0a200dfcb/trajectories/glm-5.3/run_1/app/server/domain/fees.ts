import { MEDIA_TITLES, TERRITORY_TITLES, TERRITORY_PERCENT, USAGE_TERMS, type Board, type Media, type Territory } from "../../shared/domain.js";

/** Fee arithmetic. All amounts are integer cents; each rule lives exactly here. */

export interface RateCard {
  id: string;
  name: string;
  effectiveFrom: string;
  boards: Record<Board, { fullDayCents: number; halfDayCents: number; overtimeQuarterHourCents: number }>;
  usageBaseCents: Record<Media, number>;
}

export interface UsageRow {
  media: Media;
  territory: Territory;
  termMonths: number;
}

export interface TalentFeesInput {
  displayName: string;
  board: Board;
  dayType: "full_day" | "half_day";
  overtimeMinutes: number;
  usage: UsageRow[];
}

export interface FeeLine {
  kind: "day_rate" | "half_day_rate" | "overtime" | "usage" | "service_fee" | "tax";
  label: string;
  talentId: string;
  amountCents: number;
}

/** Round half up to the nearest cent (integer). */
export function roundHalfUpInt(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) + 1e-9);
}

/** Quarter hours started: minutes divided by 15 rounded up. */
export function startedQuarterHours(minutes: number): number {
  return Math.ceil(minutes / 15);
}

export function usageFeeCents(base: number, territory: Territory, termMonths: number): number {
  const percent = TERRITORY_PERCENT[territory] * USAGE_TERMS[termMonths];
  return roundHalfUpInt((base * percent) / 10000);
}

/** Computes the talent fee lines for one talent of a group. */
export function talentFeeLines(talentId: string, input: TalentFeesInput, card: RateCard): FeeLine[] {
  const board = card.boards[input.board];
  const lines: FeeLine[] = [];
  if (input.dayType === "full_day") {
    lines.push({ kind: "day_rate", label: `Day rate: ${input.displayName}`, talentId, amountCents: board.fullDayCents });
  } else {
    lines.push({ kind: "half_day_rate", label: `Half-day rate: ${input.displayName}`, talentId, amountCents: board.halfDayCents });
  }
  const qh = startedQuarterHours(input.overtimeMinutes);
  if (qh > 0) {
    lines.push({ kind: "overtime", label: `Overtime: ${input.displayName}, ${qh} quarter hours`, talentId, amountCents: qh * board.overtimeQuarterHourCents });
  }
  for (const usage of input.usage) {
    const amount = usageFeeCents(card.usageBaseCents[usage.media], usage.territory, usage.termMonths);
    if (amount === 0) continue;
    lines.push({
      kind: "usage",
      label: `Usage: ${input.displayName}, ${MEDIA_TITLES[usage.media]}, ${TERRITORY_TITLES[usage.territory]}, ${usage.termMonths} months`,
      talentId,
      amountCents: amount,
    });
  }
  return lines.filter((l) => l.amountCents !== 0);
}

/** The agency service fee: 20% of the group's talent fees, half up. */
export function serviceFeeCents(groupTalentFees: number): number {
  return roundHalfUpInt(groupTalentFees * 0.2);
}

/** Splits the service fee across the group; leftover cents to the largest dropped fraction. */
export function splitServiceFee(feeCents: number, talentIds: string[], feeByTalent: Record<string, number>): Record<string, number> {
  const total = Object.values(feeByTalent).reduce((a, b) => a + b, 0);
  const shares: Record<string, number> = {};
  const remainders: Array<{ talentId: string; fraction: number; index: number }> = [];
  let assigned = 0;
  talentIds.forEach((id, index) => {
    const share = total === 0 ? Math.floor(feeCents / talentIds.length) : Math.floor((feeCents * feeByTalent[id]) / total);
    shares[id] = share;
    assigned += share;
    const fraction = total === 0 ? (feeCents % talentIds.length) / talentIds.length : (feeCents * feeByTalent[id]) % total;
    remainders.push({ talentId: id, fraction, index });
  });
  let leftover = feeCents - assigned;
  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const r of remainders) {
    if (leftover <= 0) break;
    shares[r.talentId] += 1;
    leftover -= 1;
  }
  return shares;
}

/** Tax lines by office, each rounded half up on its own. */
export function taxLines(office: string, taxableCents: number): FeeLine[] {
  if (office === "toronto") {
    return [{ kind: "tax", label: "HST 13%", talentId: "", amountCents: roundHalfUpInt(taxableCents * 0.13) }];
  }
  return [
    { kind: "tax", label: "GST 5%", talentId: "", amountCents: roundHalfUpInt(taxableCents * 0.05) },
    { kind: "tax", label: "PST 7%", talentId: "", amountCents: roundHalfUpInt(taxableCents * 0.07) },
  ];
}
