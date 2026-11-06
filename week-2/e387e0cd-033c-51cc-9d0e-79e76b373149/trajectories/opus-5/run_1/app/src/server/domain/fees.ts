import { formatScaled, lineAmountCents } from '../../shared/decimal';

/** The one tier pricing rule for metered messages. */

export type TierNumber = 1 | 2 | 3;

export interface TierDefinition {
  readonly tier: TierNumber;
  readonly label: string;
  /** Messages in the month covered by this tier, or null for the open-ended tier. */
  readonly capacity: number | null;
  /** Unit price per message, scaled by 10^4. */
  readonly unitPriceScaled4: Readonly<Record<string, bigint>>;
}

export const TIERS: readonly TierDefinition[] = [
  {
    tier: 1,
    label: 'Tier 1: first 100 messages',
    capacity: 100,
    unitPriceScaled4: { EUR: 4250n, SGD: 6250n },
  },
  {
    tier: 2,
    label: 'Tier 2: messages 101 to 1,000',
    capacity: 900,
    unitPriceScaled4: { EUR: 2125n, SGD: 3125n },
  },
  {
    tier: 3,
    label: 'Tier 3: messages over 1,000',
    capacity: null,
    unitPriceScaled4: { EUR: 1375n, SGD: 2050n },
  },
];

export interface FeeLine {
  readonly tier: TierNumber;
  readonly label: string;
  readonly count: number;
  readonly unitPrice: string;
  readonly amountCents: bigint;
}

function unitPriceFor(definition: TierDefinition, currency: string): bigint {
  const price = definition.unitPriceScaled4[currency];
  if (price === undefined) throw new Error(`No tier price for ${currency}`);
  return price;
}

/** One fee line per tier that holds at least one of the month's messages. */
export function feeLinesFor(messageCount: number, currency: string): FeeLine[] {
  const lines: FeeLine[] = [];
  let remaining = messageCount;
  for (const definition of TIERS) {
    if (remaining <= 0) break;
    const take = definition.capacity === null ? remaining : Math.min(remaining, definition.capacity);
    remaining -= take;
    const unitPriceScaled4 = unitPriceFor(definition, currency);
    lines.push({
      tier: definition.tier,
      label: definition.label,
      count: take,
      unitPrice: formatScaled(unitPriceScaled4, 4),
      amountCents: lineAmountCents(take, unitPriceScaled4),
    });
  }
  return lines;
}

export function totalCents(lines: readonly FeeLine[]): bigint {
  return lines.reduce((sum, line) => sum + line.amountCents, 0n);
}
