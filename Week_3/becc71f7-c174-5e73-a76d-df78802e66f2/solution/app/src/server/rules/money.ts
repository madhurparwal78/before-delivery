// Markdown prices and the sale split: integer cents, rounded half up, decided only here.

function halfUp(numerator: number, denominator: number): number {
  const doubled = numerator * 2 + denominator;
  return (doubled - (doubled % (denominator * 2))) / (denominator * 2);
}

export function markdownPrice(askingCents: number, percentOff: number): number {
  return halfUp(askingCents * (100 - percentOff), 100);
}

const SHARE_STEP_CENTS = 30_000;

export function splitSale(priceCents: number): { consignorShareCents: number; commissionCents: number; vatCents: number } {
  const consignorShareCents = halfUp(priceCents * (priceCents <= SHARE_STEP_CENTS ? 60 : 70), 100);
  const commissionCents = priceCents - consignorShareCents;
  return { consignorShareCents, commissionCents, vatCents: halfUp(commissionCents * 21, 121) };
}
