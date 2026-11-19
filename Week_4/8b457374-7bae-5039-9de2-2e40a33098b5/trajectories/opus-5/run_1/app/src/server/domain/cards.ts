/** How each invented test number stands in for the card network. */
export type CardBehaviour = 'captures' | 'declines_authorisation' | 'fails_capture';

const TEST_CARDS = new Map<string, CardBehaviour>([
  ['4242424242424242', 'captures'],
  ['4000000000000002', 'declines_authorisation'],
  ['4000000000000341', 'fails_capture'],
]);

export interface TestCard {
  readonly last4: string;
  readonly behaviour: CardBehaviour;
}

/** Spaces are ignored; any number outside the table is not a usable card. */
export function readCard(raw: string): TestCard | null {
  const digits = raw.replace(/ /g, '');
  const behaviour = TEST_CARDS.get(digits);
  if (behaviour === undefined) return null;
  return { last4: digits.slice(-4), behaviour };
}
