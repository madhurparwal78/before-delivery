/**
 * Every amount in the product is computed here, in integer euro cents, and
 * stored on the order. Screens, Kill Bill records, invoice PDFs and email all
 * read that stored amount.
 */

export type LicenceType = 'personal' | 'commercial' | 'studio' | 'edition';

/** The three licences the catalogue facets over. */
export type CatalogueLicence = 'personal' | 'commercial' | 'studio';

export function isLicenceType(v: unknown): v is LicenceType {
  return v === 'personal' || v === 'commercial' || v === 'studio' || v === 'edition';
}

export const MIN_PRICE_CENTS = 100;
export const MAX_PRICE_CENTS = 100_000;

export function isValidPriceCents(cents: number): boolean {
  return (
    Number.isSafeInteger(cents) && cents >= MIN_PRICE_CENTS && cents <= MAX_PRICE_CENTS
  );
}

export function isValidDiscountPercent(percent: number): boolean {
  return Number.isSafeInteger(percent) && percent >= 0 && percent <= 90;
}

const SEATS: Readonly<Record<LicenceType, number>> = {
  personal: 1,
  commercial: 1,
  studio: 3,
  edition: 1,
};

export function seatsFor(licence: LicenceType): number {
  return SEATS[licence];
}

/** The single rounding step: half up to the cent, on non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** A licence's price is its list price less the model's discount. */
export function discountedPriceCents(listCents: number, discountPercent: number): number {
  return divRoundHalfUp(listCents * (100 - discountPercent), 100);
}

const UPGRADE_TARGETS: Readonly<Record<LicenceType, readonly LicenceType[]>> = {
  personal: ['commercial', 'studio'],
  commercial: ['studio'],
  studio: [],
  edition: [],
};

export function upgradeTargets(from: LicenceType): readonly LicenceType[] {
  return UPGRADE_TARGETS[from];
}

export function canUpgrade(from: LicenceType, to: LicenceType): boolean {
  return UPGRADE_TARGETS[from].includes(to);
}

/**
 * The upgrade amount is the target licence's current discounted price less the
 * net amount paid, after refunds, across the source order and every earlier
 * order in its upgrade chain. Zero or less is not an upgrade.
 */
export function upgradeAmountCents(
  targetPriceCents: number,
  netPaidInChainCents: number,
): number {
  return targetPriceCents - netPaidInChainCents;
}

/** Seat refunds apply to studio licences only. */
export function seatRefundCents(orderAmountCents: number, seats: number): number {
  return divRoundHalfUp(orderAmountCents * seats, SEATS.studio);
}

export type OrderStatus = 'paid' | 'partially_refunded' | 'refunded';

export function orderStatus(amountCents: number, refundedCents: number): OrderStatus {
  if (refundedCents <= 0) return 'paid';
  if (refundedCents >= amountCents) return 'refunded';
  return 'partially_refunded';
}

export function refundableCents(amountCents: number, refundedCents: number): number {
  const left = amountCents - refundedCents;
  return left > 0 ? left : 0;
}

/** The Kill Bill charge description, and the `<Licence>` word it carries. */
export function licenceWord(licence: LicenceType): string {
  switch (licence) {
    case 'personal':
      return 'Personal';
    case 'commercial':
      return 'Commercial';
    case 'studio':
      return 'Studio';
    case 'edition':
      return 'Personal';
  }
}

export function chargeDescription(
  title: string,
  licence: LicenceType,
  editionNumber: number | null,
  isUpgrade: boolean,
): string {
  if (isUpgrade) return `${title} · Upgrade to ${licenceWord(licence)} licence`;
  if (licence === 'edition' && editionNumber !== null) {
    return `${title} · Edition copy No. ${editionNumber}`;
  }
  return `${title} · ${licenceWord(licence)} licence`;
}

/** Euro amount string Kill Bill is given, from integer cents. */
export function centsToEuroString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
