// The brief's invented test cards stand in for the card network (Business rules › Test cards).
// Only the last four digits are kept, and they are enough to tell the test cards apart.

interface TestCard {
  authorises: boolean;
  captures: boolean;
}

const TEST_CARDS: Record<string, TestCard> = {
  "4242424242424242": { authorises: true, captures: true },
  "4000000000000002": { authorises: false, captures: false },
  "4000000000000341": { authorises: true, captures: false },
};

export interface Card extends TestCard {
  last4: string;
}

/** The test card for a typed number (spaces ignored), or null for any other number. */
export function testCard(value: unknown): Card | null {
  if (typeof value !== "string") return null;
  const digits = value.replaceAll(" ", "");
  const card = TEST_CARDS[digits];
  return card ? { ...card, last4: digits.slice(-4) } : null;
}

/** Whether the network accepts a capture on a held card, known from its last four digits. */
export function capturesOn(last4: string): boolean {
  return Object.entries(TEST_CARDS).some(([number, card]) => number.endsWith(last4) && card.captures);
}

export const CARD_FIELD_ERROR = "Use one of the test cards.";
