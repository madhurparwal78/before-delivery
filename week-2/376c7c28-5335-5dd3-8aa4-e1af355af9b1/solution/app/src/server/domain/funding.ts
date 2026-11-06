export type Funding = 'credit' | 'card';
export type CardStatus = 'none' | 'on_file';

/**
 * Charge funding, decided only here: credit when it covers the fee, otherwise the card when
 * one is on file, otherwise credit anyway so the balance goes below zero.
 */
export function chooseFunding(
  balanceCents: number,
  feeCents: number,
  cardStatus: CardStatus,
): Funding {
  if (balanceCents >= feeCents) return 'credit';
  if (cardStatus === 'on_file') return 'card';
  return 'credit';
}
