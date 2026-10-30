/** The country table, the Canadian province tax table and the warehouse calendar. */

export interface TaxComponentRate {
  name: string;
  rate_pcm: number;
}

export interface CountryRule {
  code: string;
  name: string;
  packageShippingCents: number;
  accessoryShippingCents: number;
  freeAccessoryShippingFromCents: number | null;
  packedBatteryFeeCents: number;
  standaloneBatteryFeeCents: number;
  taxes: TaxComponentRate[] | null;
  warehouse: 'San Juan' | 'Madrid';
  transitBusinessDays: number;
  warrantyTimezone: string;
  boardWarrantyMonths: number;
}

export const COUNTRIES: readonly CountryRule[] = [
  {
    code: 'US',
    name: 'United States',
    packageShippingCents: 0,
    accessoryShippingCents: 1500,
    freeAccessoryShippingFromCents: 100000,
    packedBatteryFeeCents: 2500,
    standaloneBatteryFeeCents: 4500,
    taxes: [{ name: 'Sales tax', rate_pcm: 7250 }],
    warehouse: 'San Juan',
    transitBusinessDays: 2,
    warrantyTimezone: 'America/New_York',
    boardWarrantyMonths: 12,
  },
  {
    code: 'PR',
    name: 'Puerto Rico',
    packageShippingCents: 0,
    accessoryShippingCents: 1500,
    freeAccessoryShippingFromCents: 100000,
    packedBatteryFeeCents: 5500,
    standaloneBatteryFeeCents: 9500,
    taxes: [{ name: 'Sales tax', rate_pcm: 11500 }],
    warehouse: 'San Juan',
    transitBusinessDays: 1,
    warrantyTimezone: 'America/Puerto_Rico',
    boardWarrantyMonths: 12,
  },
  {
    code: 'CA',
    name: 'Canada',
    packageShippingCents: 39900,
    accessoryShippingCents: 3500,
    freeAccessoryShippingFromCents: null,
    packedBatteryFeeCents: 3500,
    standaloneBatteryFeeCents: 6500,
    taxes: null,
    warehouse: 'San Juan',
    transitBusinessDays: 4,
    warrantyTimezone: 'America/Toronto',
    boardWarrantyMonths: 12,
  },
  {
    code: 'DE',
    name: 'Germany',
    packageShippingCents: 59900,
    accessoryShippingCents: 4500,
    freeAccessoryShippingFromCents: null,
    packedBatteryFeeCents: 4500,
    standaloneBatteryFeeCents: 8500,
    taxes: [{ name: 'VAT', rate_pcm: 19000 }],
    warehouse: 'Madrid',
    transitBusinessDays: 3,
    warrantyTimezone: 'Europe/Berlin',
    boardWarrantyMonths: 24,
  },
  {
    code: 'FR',
    name: 'France',
    packageShippingCents: 59900,
    accessoryShippingCents: 4500,
    freeAccessoryShippingFromCents: null,
    packedBatteryFeeCents: 4500,
    standaloneBatteryFeeCents: 8500,
    taxes: [{ name: 'VAT', rate_pcm: 20000 }],
    warehouse: 'Madrid',
    transitBusinessDays: 2,
    warrantyTimezone: 'Europe/Paris',
    boardWarrantyMonths: 24,
  },
  {
    code: 'AU',
    name: 'Australia',
    packageShippingCents: 79900,
    accessoryShippingCents: 6500,
    freeAccessoryShippingFromCents: null,
    packedBatteryFeeCents: 7500,
    standaloneBatteryFeeCents: 12500,
    taxes: [{ name: 'GST', rate_pcm: 10000 }],
    warehouse: 'San Juan',
    transitBusinessDays: 6,
    warrantyTimezone: 'Australia/Sydney',
    boardWarrantyMonths: 12,
  },
];

export const BATTERY_WARRANTY_MONTHS = 18;

export function countryRule(code: unknown): CountryRule | undefined {
  return typeof code === 'string' ? COUNTRIES.find((c) => c.code === code) : undefined;
}

export interface ProvinceRule {
  letters: string[];
  province: string;
  taxes: TaxComponentRate[];
}

export const CANADIAN_PROVINCES: readonly ProvinceRule[] = [
  {
    letters: ['A', 'C', 'E'],
    province: 'Newfoundland and Labrador, Prince Edward Island, New Brunswick',
    taxes: [{ name: 'HST', rate_pcm: 15000 }],
  },
  { letters: ['B'], province: 'Nova Scotia', taxes: [{ name: 'HST', rate_pcm: 14000 }] },
  { letters: ['K', 'L', 'M', 'N', 'P'], province: 'Ontario', taxes: [{ name: 'HST', rate_pcm: 13000 }] },
  {
    letters: ['G', 'H', 'J'],
    province: 'Quebec',
    taxes: [
      { name: 'GST', rate_pcm: 5000 },
      { name: 'QST', rate_pcm: 9975 },
    ],
  },
  {
    letters: ['R', 'V'],
    province: 'Manitoba, British Columbia',
    taxes: [
      { name: 'GST', rate_pcm: 5000 },
      { name: 'PST', rate_pcm: 7000 },
    ],
  },
  {
    letters: ['S'],
    province: 'Saskatchewan',
    taxes: [
      { name: 'GST', rate_pcm: 5000 },
      { name: 'PST', rate_pcm: 6000 },
    ],
  },
  {
    letters: ['T', 'X', 'Y'],
    province: 'Alberta, Northwest Territories and Nunavut, Yukon',
    taxes: [{ name: 'GST', rate_pcm: 5000 }],
  },
];

const CANADIAN_POSTAL = /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ] ?[0-9][ABCEGHJKLMNPRSTVWXYZ][0-9]$/;

export function isCanadianPostalCode(value: unknown): value is string {
  return typeof value === 'string' && CANADIAN_POSTAL.test(value.trim().toUpperCase());
}

export function canadianTaxes(postalCode: string): TaxComponentRate[] {
  const letter = postalCode.trim().toUpperCase().charAt(0);
  const rule = CANADIAN_PROVINCES.find((p) => p.letters.includes(letter));
  if (!rule) throw new Error(`No province for postal code ${postalCode}`);
  return rule.taxes;
}

export function taxRatesFor(country: CountryRule, postalCode: string | null): TaxComponentRate[] {
  if (country.taxes) return country.taxes;
  if (!postalCode) throw new Error('Canadian tax needs a postal code');
  return canadianTaxes(postalCode);
}

export const WAREHOUSE_TIMEZONE: Record<CountryRule['warehouse'], string> = {
  'San Juan': 'America/Puerto_Rico',
  Madrid: 'Europe/Madrid',
};

export const WAREHOUSE_HOLIDAYS: Record<CountryRule['warehouse'], readonly string[]> = {
  'San Juan': ['2026-11-11', '2026-11-19', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-06'],
  Madrid: ['2026-11-02', '2026-11-09', '2026-12-07', '2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06'],
};
