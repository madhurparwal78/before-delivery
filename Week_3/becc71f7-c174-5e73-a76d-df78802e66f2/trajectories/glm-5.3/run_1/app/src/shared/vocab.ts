// Published vocabularies (labels ↔ API values).

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

export const SIZES = [
  { value: 'xs', label: 'XS' },
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(36 + i), label: String(36 + i) })),
  { value: 'one_size', label: 'One size' },
] as const;

export const CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'very_good', label: 'Very good' },
  { value: 'good', label: 'Good' },
] as const;

export const PAYMENTS = [
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
] as const;

export const STATIONS = ['full_price', 'off_25', 'off_50', 'period_ends'] as const;
export type StationValue = (typeof STATIONS)[number];

export const PRICE_BANDS = [
  { value: 'under-50', label: 'Under \u20AC50', min: 0, max: 4999 },
  { value: '50-100', label: '\u20AC50 to \u20AC100', min: 5000, max: 9999 },
  { value: '100-200', label: '\u20AC100 to \u20AC200', min: 10000, max: 19999 },
  { value: '200-plus', label: '\u20AC200 and over', min: 20000, max: Number.MAX_SAFE_INTEGER },
] as const;

export const PIECE_STATUSES = [
  { value: 'on_rail', label: 'On the rail' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'sold', label: 'Sold' },
  { value: 'returns_shelf', label: 'Returns shelf' },
  { value: 'donation_box', label: 'Donation box' },
  { value: 'returned', label: 'Returned' },
  { value: 'archived', label: 'Archived' },
] as const;

export const ROLES = [
  { value: 'owner', label: 'Shop owner' },
  { value: 'assistant', label: 'Shop assistant' },
  { value: 'bookkeeper', label: 'Bookkeeper' },
] as const;

export const CHOICES = [
  { value: 'return', label: 'Return to me' },
  { value: 'donate', label: 'Donate' },
] as const;

export function categoryLabel(value: string): string { return CATEGORIES.find((c) => c.value === value)?.label ?? value; }
export function sizeLabel(value: string): string { return SIZES.find((s) => s.value === value)?.label ?? value; }
export function conditionLabel(value: string): string { return CONDITIONS.find((c) => c.value === value)?.label ?? value; }
export function paymentLabel(value: string): string { return PAYMENTS.find((p) => p.value === value)?.label ?? value; }
export function statusLabel(value: string): string { return PIECE_STATUSES.find((s) => s.value === value)?.label ?? value; }
export function roleLabel(value: string): string { return ROLES.find((r) => r.value === value)?.label ?? value; }
export function choiceLabel(value: string): string { return CHOICES.find((c) => c.value === value)?.label ?? value; }
