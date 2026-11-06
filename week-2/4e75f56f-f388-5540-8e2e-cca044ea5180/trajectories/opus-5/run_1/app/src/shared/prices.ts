import type { Tier } from './benches.js';

interface TierPrice {
  readonly fullCents: number;
  readonly depositCents: number;
  readonly balanceCents: number;
}

export const PRICES: Record<Tier, TierPrice> = {
  bench: { fullCents: 345000, depositCents: 90000, balanceCents: 255000 },
  atelier: { fullCents: 590000, depositCents: 150000, balanceCents: 440000 },
};

export const UPGRADE_DIFFERENCE_CENTS = 245000;
