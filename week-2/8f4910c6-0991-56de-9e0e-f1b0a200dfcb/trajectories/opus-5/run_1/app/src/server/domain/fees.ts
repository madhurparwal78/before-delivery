import { MEDIA_NAMES, TERRITORY_NAMES, roundHalfUp } from '../../shared/format.js';
import type {
  Board,
  BookingLine,
  BookingTalent,
  DayType,
  Media,
  OfficeId,
  RateCard,
  Territory,
} from '../../shared/types.js';

export type UsageRow = { media: Media; territory: Territory; termMonths: number };

export type TalentFeeInput = {
  talentId: string;
  displayName: string;
  board: Board;
  dayType: DayType;
  overtimeMinutes: number;
  usage: UsageRow[];
};

export type ComputedFees = {
  lines: BookingLine[];
  talent: BookingTalent[];
  talentFeesCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
};

const TERRITORY_PERCENT: Record<Territory, number> = {
  canada: 100,
  north_america: 150,
  worldwide: 250,
};

const TERM_PERCENT: Record<number, number> = { 3: 50, 6: 75, 12: 100 };

const SERVICE_FEE_PERCENT = 20;

const TAX_LINES: Record<OfficeId, Array<{ label: string; percent: number }>> = {
  toronto: [{ label: 'HST 13%', percent: 13 }],
  vancouver: [
    { label: 'GST 5%', percent: 5 },
    { label: 'PST 7%', percent: 7 },
  ],
};

function startedQuarterHours(overtimeMinutes: number): number {
  return Math.ceil(overtimeMinutes / 15);
}

function usageFeeCents(card: RateCard, usage: UsageRow): number {
  const base = card.usageBaseCents[usage.media];
  const percent = TERRITORY_PERCENT[usage.territory] * TERM_PERCENT[usage.termMonths];
  return roundHalfUp((base * percent) / 10_000);
}

/** Splits the service fee by share of talent fees; leftover cents go to the largest dropped fraction. */
function splitServiceFee(serviceFeeCents: number, talentFees: number[]): number[] {
  const total = talentFees.reduce((sum, value) => sum + value, 0);
  if (total === 0 || serviceFeeCents === 0) return talentFees.map(() => 0);
  const exact = talentFees.map((fee) => (fee * serviceFeeCents) / total);
  const shares = exact.map((value) => Math.floor(value));
  let leftover = serviceFeeCents - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => (b.fraction - a.fraction) || (a.index - b.index));
  let cursor = 0;
  while (leftover > 0) {
    shares[order[cursor % order.length].index] += 1;
    leftover -= 1;
    cursor += 1;
  }
  return shares;
}

/** Prices a confirm in integer cents: day, overtime, usage, service fee and tax. */
export function computeFees(input: {
  card: RateCard;
  office: OfficeId;
  talent: TalentFeeInput[];
}): ComputedFees {
  const { card, office, talent } = input;
  const perTalentLines: BookingLine[][] = [];
  const talentFees: number[] = [];

  for (const entry of talent) {
    const rates = card.boards[entry.board];
    const lines: BookingLine[] = [];
    const dayAmount = entry.dayType === 'full_day' ? rates.fullDayCents : rates.halfDayCents;
    if (dayAmount !== 0) {
      lines.push({
        kind: entry.dayType === 'full_day' ? 'day_rate' : 'half_day_rate',
        label: `${entry.dayType === 'full_day' ? 'Day rate' : 'Half-day rate'}: ${entry.displayName}`,
        talentId: entry.talentId,
        amountCents: dayAmount,
      });
    }
    const quarters = startedQuarterHours(entry.overtimeMinutes);
    const overtimeAmount = quarters * rates.overtimeQuarterHourCents;
    if (overtimeAmount !== 0) {
      lines.push({
        kind: 'overtime',
        label: `Overtime: ${entry.displayName}, ${quarters} quarter hours`,
        talentId: entry.talentId,
        amountCents: overtimeAmount,
      });
    }
    for (const usage of entry.usage) {
      const amount = usageFeeCents(card, usage);
      if (amount === 0) continue;
      lines.push({
        kind: 'usage',
        label: `Usage: ${entry.displayName}, ${MEDIA_NAMES[usage.media]}, ${TERRITORY_NAMES[usage.territory]}, ${usage.termMonths} months`,
        talentId: entry.talentId,
        amountCents: amount,
      });
    }
    perTalentLines.push(lines);
    talentFees.push(lines.reduce((sum, line) => sum + line.amountCents, 0));
  }

  const talentFeesCents = talentFees.reduce((sum, value) => sum + value, 0);
  const serviceFeeCents = roundHalfUp((talentFeesCents * SERVICE_FEE_PERCENT) / 100);
  const shares = splitServiceFee(serviceFeeCents, talentFees);
  const taxBase = talentFeesCents + serviceFeeCents;

  const lines: BookingLine[] = perTalentLines.flat();
  if (serviceFeeCents !== 0) {
    lines.push({
      kind: 'service_fee',
      label: `Agency service fee ${SERVICE_FEE_PERCENT}%`,
      talentId: null,
      amountCents: serviceFeeCents,
    });
  }
  let taxCents = 0;
  for (const tax of TAX_LINES[office]) {
    const amount = roundHalfUp((taxBase * tax.percent) / 100);
    taxCents += amount;
    if (amount === 0) continue;
    lines.push({ kind: 'tax', label: tax.label, talentId: null, amountCents: amount });
  }

  return {
    lines,
    talent: talent.map((entry, index) => ({
      talentId: entry.talentId,
      displayName: entry.displayName,
      talentFeesCents: talentFees[index],
      serviceFeeShareCents: shares[index],
    })),
    talentFeesCents,
    serviceFeeCents,
    taxCents,
    totalCents: taxBase + taxCents,
  };
}

export function rateCardFor(cards: RateCard[], jobDate: string): RateCard | null {
  const eligible = cards
    .filter((card) => card.effectiveFrom <= jobDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eligible[0] ?? null;
}
