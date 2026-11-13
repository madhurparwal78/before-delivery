import { config } from '../config';

export type Airline = {
  code: string;
  name: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
};

export const AIRLINES: Airline[] = [
  { code: 'skyline-indus', name: 'Skyline Indus', height_cm: 55, width_cm: 40, depth_cm: 20, weight_kg: 7 },
  { code: 'monsoon-air', name: 'Monsoon Air', height_cm: 56, width_cm: 36, depth_cm: 23, weight_kg: 8 },
  { code: 'coastal-hop', name: 'Coastal Hop', height_cm: 52, width_cm: 40, depth_cm: 22, weight_kg: 7 },
  { code: 'northwind', name: 'Northwind Regional', height_cm: 40, width_cm: 30, depth_cm: 20, weight_kg: 5 }
];

export const DEFAULT_AIRLINE = 'skyline-indus';

export function findAirline(code: string): Airline | null {
  return AIRLINES.find((airline) => airline.code === code) ?? null;
}

export const COLLECTIONS = [
  { slug: 'all', name: 'All bags' },
  { slug: 'luggage', name: 'Luggage' },
  { slug: 'backpacks', name: 'Backpacks' },
  { slug: 'totes', name: 'Totes' },
  { slug: 'wallets', name: 'Wallets' },
  { slug: 'accessories', name: 'Accessories' }
] as const;

export const CATEGORIES = ['luggage', 'backpacks', 'totes', 'wallets', 'accessories'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  luggage: 'Luggage',
  backpacks: 'Backpacks',
  totes: 'Totes',
  wallets: 'Wallets',
  accessories: 'Accessories'
};

export const CABIN_FIT_CATEGORIES: readonly string[] = ['luggage', 'backpacks', 'totes'];

export const SIZE_ORDER = [
  { label: 'Cabin', slug: 'cabin', code: 'C' },
  { label: 'Check-in Medium', slug: 'check-in-medium', code: 'M' },
  { label: 'Check-in Large', slug: 'check-in-large', code: 'L' },
  { label: 'Underseat', slug: 'underseat', code: 'U' },
  { label: 'One size', slug: 'one-size', code: 'O' }
] as const;

export const COLOUR_CODES: Record<string, string> = {
  Graphite: 'GRA',
  Sage: 'SAG',
  'Signal Red': 'RED',
  Silver: 'SIL',
  Navy: 'NAV',
  Teal: 'TEA',
  Yellow: 'YEL',
  Blue: 'BLU',
  Sand: 'SND',
  Tan: 'TAN',
  Black: 'BLK',
  Grey: 'GRY'
};

export const COLOUR_ORDER = [
  'Graphite',
  'Sage',
  'Signal Red',
  'Silver',
  'Navy',
  'Teal',
  'Yellow',
  'Blue',
  'Sand',
  'Tan',
  'Black',
  'Grey'
];

export const COLOUR_HEX: Record<string, string> = {
  Graphite: '#3c3f42',
  Sage: '#8a9a7b',
  'Signal Red': '#c8322c',
  Silver: '#b9bdc0',
  Navy: '#24324f',
  Teal: '#0f5f5c',
  Yellow: '#e9b949',
  Blue: '#1f4fd8',
  Sand: '#d2bb94',
  Tan: '#a9744f',
  Black: '#17181a',
  Grey: '#7d8184'
};

export type PriceBand = { slug: string; label: string; min: number; max: number | null };

export const PRICE_BANDS: PriceBand[] = [
  { slug: 'under-5000', label: 'Under ₹5,000', min: 0, max: 4999 },
  { slug: '5000-9999', label: '₹5,000 to ₹9,999', min: 5000, max: 9999 },
  { slug: '10000-19999', label: '₹10,000 to ₹19,999', min: 10000, max: 19999 },
  { slug: '20000-plus', label: '₹20,000 and over', min: 20000, max: null }
];

export function priceBandSlugs(price: number): string[] {
  return PRICE_BANDS.filter((band) => price >= band.min && (band.max === null || price <= band.max)).map(
    (band) => band.slug
  );
}

export const CARRIERS = ['Coastline Couriers', 'Peak Express'];

export const LOCATIONS = ['bhiwandi', 'gurugram'] as const;
export type Location = (typeof LOCATIONS)[number];

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Tamil Nadu',
  'Telangana',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal'
];

export const RETURN_REASONS = ['Changed my mind', 'Wrong size', 'Colour not as expected', 'Arrived damaged', 'Other'];
export const CLAIM_COMPONENTS = ['Wheels', 'Handle', 'Shell', 'Zipper', 'Lock'];

export function warrantyYearsFor(category: string): number {
  if (category === 'luggage') return config.warrantyYearsLuggage;
  if (category === 'backpacks' || category === 'totes') return config.warrantyYearsBags;
  return config.warrantyYearsAccessories;
}

export const GALLERY_STUDIES = ['Front', 'Side', 'Back', 'Open'];
