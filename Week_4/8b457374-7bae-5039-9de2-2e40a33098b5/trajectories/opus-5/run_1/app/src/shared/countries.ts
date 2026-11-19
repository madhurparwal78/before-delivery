export type Zone = 'domestic' | 'europe' | 'rest_of_world';

export interface Country {
  readonly code: string;
  readonly name: string;
  readonly european: boolean;
}

/** The accepted country codes with the names shown in the pickers. */
export const COUNTRIES: readonly Country[] = [
  { code: 'AT', name: 'Austria', european: true },
  { code: 'AU', name: 'Australia', european: false },
  { code: 'BE', name: 'Belgium', european: true },
  { code: 'BR', name: 'Brazil', european: false },
  { code: 'CA', name: 'Canada', european: false },
  { code: 'CH', name: 'Switzerland', european: true },
  { code: 'DE', name: 'Germany', european: true },
  { code: 'DK', name: 'Denmark', european: true },
  { code: 'ES', name: 'Spain', european: true },
  { code: 'FI', name: 'Finland', european: true },
  { code: 'FR', name: 'France', european: true },
  { code: 'GB', name: 'United Kingdom', european: true },
  { code: 'IE', name: 'Ireland', european: true },
  { code: 'IT', name: 'Italy', european: true },
  { code: 'JP', name: 'Japan', european: false },
  { code: 'MX', name: 'Mexico', european: false },
  { code: 'NL', name: 'Netherlands', european: true },
  { code: 'NO', name: 'Norway', european: true },
  { code: 'NZ', name: 'New Zealand', european: false },
  { code: 'PL', name: 'Poland', european: true },
  { code: 'PT', name: 'Portugal', european: true },
  { code: 'SE', name: 'Sweden', european: true },
  { code: 'SG', name: 'Singapore', european: false },
  { code: 'US', name: 'United States', european: false },
];

/** The pickers list countries sorted by name. */
export const COUNTRIES_BY_NAME: readonly Country[] = [...COUNTRIES].sort((a, b) =>
  a.name.localeCompare(b.name, 'en'),
);

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function isCountryCode(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * A backer's zone is domestic when their country equals the campaign's ships_from,
 * otherwise europe when the country is in the European list, otherwise rest_of_world.
 */
export function zoneFor(shipsFrom: string, country: string): Zone {
  if (country === shipsFrom) return 'domestic';
  return BY_CODE.get(country)?.european ? 'europe' : 'rest_of_world';
}

export const ZONE_NAMES: Readonly<Record<Zone, string>> = {
  domestic: 'Domestic',
  europe: 'Europe',
  rest_of_world: 'Rest of world',
};
