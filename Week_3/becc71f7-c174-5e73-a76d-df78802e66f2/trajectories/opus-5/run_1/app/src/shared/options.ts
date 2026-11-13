export const CATEGORIES = [
  { value: 'coats', label: 'Coats' },
  { value: 'jackets', label: 'Jackets' },
  { value: 'dresses', label: 'Dresses' },
  { value: 'knitwear', label: 'Knitwear' },
  { value: 'shirts', label: 'Shirts' },
  { value: 'trousers', label: 'Trousers' },
  { value: 'skirts', label: 'Skirts' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'bags', label: 'Bags' },
  { value: 'accessories', label: 'Accessories' },
] as const;

export type Category = (typeof CATEGORIES)[number]['value'];

export const SIZES = [
  { value: 'xs', label: 'XS' },
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
  { value: '36', label: '36' },
  { value: '37', label: '37' },
  { value: '38', label: '38' },
  { value: '39', label: '39' },
  { value: '40', label: '40' },
  { value: '41', label: '41' },
  { value: '42', label: '42' },
  { value: '43', label: '43' },
  { value: '44', label: '44' },
  { value: '45', label: '45' },
  { value: 'one_size', label: 'One size' },
] as const;

export type Size = (typeof SIZES)[number]['value'];

export const CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'very_good', label: 'Very good' },
  { value: 'good', label: 'Good' },
] as const;

export type Condition = (typeof CONDITIONS)[number]['value'];

export const PAYMENTS = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
] as const;

export type Payment = (typeof PAYMENTS)[number]['value'];

export const STATIONS = ['full_price', 'off_25', 'off_50', 'period_ends'] as const;
export type StationName = (typeof STATIONS)[number];
export type StationState = 'done' | 'current' | 'next';

export const PIECE_STATUSES = [
  { value: 'on_rail', label: 'On the rail' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'sold', label: 'Sold' },
  { value: 'returns_shelf', label: 'Returns shelf' },
  { value: 'donation_box', label: 'Donation box' },
  { value: 'returned', label: 'Returned' },
  { value: 'archived', label: 'Archived' },
] as const;

export type PieceStatus = (typeof PIECE_STATUSES)[number]['value'];

export const RAIL_STATUS_FILTERS = PIECE_STATUSES.filter(
  (s) => s.value !== 'returned',
) as readonly { value: PieceStatus; label: string }[];

export const CHOICES = [
  { value: 'return', label: 'Return to me' },
  { value: 'donate', label: 'Donate' },
] as const;

export type Choice = (typeof CHOICES)[number]['value'];

export const PRICE_BANDS = [
  { value: 'under-50', label: 'Under €50' },
  { value: '50-100', label: '€50 to €100' },
  { value: '100-200', label: '€100 to €200' },
  { value: '200-plus', label: '€200 and over' },
] as const;

export type PriceBand = (typeof PRICE_BANDS)[number]['value'];

export const ROLES = [
  { value: 'owner', label: 'Shop owner' },
  { value: 'assistant', label: 'Shop assistant' },
  { value: 'bookkeeper', label: 'Bookkeeper' },
] as const;

export type Role = (typeof ROLES)[number]['value'];

export const CONSIGNOR_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'erasing', label: 'Erasing' },
  { value: 'erased', label: 'Erased' },
] as const;

export type ConsignorStatus = (typeof CONSIGNOR_STATUSES)[number]['value'];

export const PAYOUT_STATUSES = [
  { value: 'paid', label: 'Paid' },
  { value: 'held_back', label: 'Held back' },
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number]['value'];

export const IMPORT_ROW_STATUSES = [
  { value: 'matched', label: 'Matched' },
  { value: 'new', label: 'New' },
  { value: 'refused', label: 'Refused' },
  { value: 'already', label: 'Already brought over' },
] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number]['value'];

const labelLookup = <T extends readonly { value: string; label: string }[]>(options: T) => {
  const map = new Map(options.map((o) => [o.value, o.label]));
  return (value: string): string => map.get(value) ?? value;
};

export const sizeLabel = labelLookup(SIZES);
export const conditionLabel = labelLookup(CONDITIONS);
export const paymentLabel = labelLookup(PAYMENTS);
export const pieceStatusLabel = labelLookup(PIECE_STATUSES);
export const roleLabel = labelLookup(ROLES);
export const consignorStatusLabel = labelLookup(CONSIGNOR_STATUSES);
export const payoutStatusLabel = labelLookup(PAYOUT_STATUSES);
export const importRowStatusLabel = labelLookup(IMPORT_ROW_STATUSES);

export const isCategory = (v: string): v is Category => CATEGORIES.some((c) => c.value === v);
export const isSize = (v: string): v is Size => SIZES.some((s) => s.value === v);
export const isCondition = (v: string): v is Condition => CONDITIONS.some((c) => c.value === v);
export const isPayment = (v: string): v is Payment => PAYMENTS.some((p) => p.value === v);
export const isPriceBand = (v: string): v is PriceBand => PRICE_BANDS.some((b) => b.value === v);
export const isChoice = (v: string): v is Choice => CHOICES.some((c) => c.value === v);
export const isPieceStatus = (v: string): v is PieceStatus =>
  PIECE_STATUSES.some((s) => s.value === v);
