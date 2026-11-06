export type FlavourSlug = 'guava-lime' | 'yuzu-ginger' | 'passionfruit-basil' | 'cacao-orange';

export type ProvinceCode = 'AB' | 'BC' | 'NS' | 'ON' | 'QC';

export interface TaxLineDef {
  readonly name: string;
  /** Percent as a string with three decimals, for example "9.975". */
  readonly rate: string;
}

export interface FlavourSeed {
  readonly slug: FlavourSlug;
  readonly name: string;
  readonly canPriceCents: number;
  readonly limited: boolean;
  readonly subscribable: boolean;
  readonly received: number;
  readonly released: number | null;
  /** Label colours used on the card stripe, filled slots and the can. */
  readonly label: { readonly base: string; readonly band: string | null };
}

export interface ProvinceSeed {
  readonly code: ProvinceCode;
  readonly name: string;
  readonly taxes: readonly TaxLineDef[];
  readonly depositCentsPerCan: number;
  readonly shippingCents: number;
  readonly freeShippingThresholdCents: number;
  readonly postalLetters: readonly string[];
}

export const FLAVOURS: readonly FlavourSeed[] = [
  {
    slug: 'guava-lime',
    name: 'Guava & Lime',
    canPriceCents: 333,
    limited: false,
    subscribable: true,
    received: 600,
    released: null,
    label: { base: '#e2567f', band: '#a9d13c' },
  },
  {
    slug: 'yuzu-ginger',
    name: 'Yuzu Ginger',
    canPriceCents: 333,
    limited: false,
    subscribable: true,
    received: 600,
    released: null,
    label: { base: '#e8bb2e', band: null },
  },
  {
    slug: 'passionfruit-basil',
    name: 'Passionfruit Basil',
    canPriceCents: 333,
    limited: false,
    subscribable: true,
    received: 600,
    released: null,
    label: { base: '#7b4ea8', band: null },
  },
  {
    slug: 'cacao-orange',
    name: 'Cacao Orange',
    canPriceCents: 375,
    limited: true,
    subscribable: false,
    received: 120,
    released: 48,
    label: { base: '#4a2c1a', band: '#e8762c' },
  },
];



const FLAVOUR_BY_SLUG = new Map<string, FlavourSeed>(FLAVOURS.map((f) => [f.slug, f]));

export function findFlavour(slug: string): FlavourSeed | undefined {
  return FLAVOUR_BY_SLUG.get(slug);
}

export function flavourName(slug: FlavourSlug): string {
  const found = FLAVOUR_BY_SLUG.get(slug);
  if (!found) throw new Error(`unknown flavour ${slug}`);
  return found.name;
}

export const PROVINCES: readonly ProvinceSeed[] = [
  {
    code: 'AB',
    name: 'Alberta',
    taxes: [{ name: 'GST', rate: '5.000' }],
    depositCentsPerCan: 10,
    shippingCents: 1495,
    freeShippingThresholdCents: 4500,
    postalLetters: ['T'],
  },
  {
    code: 'BC',
    name: 'British Columbia',
    taxes: [
      { name: 'GST', rate: '5.000' },
      { name: 'PST', rate: '7.000' },
    ],
    depositCentsPerCan: 10,
    shippingCents: 1495,
    freeShippingThresholdCents: 4500,
    postalLetters: ['V'],
  },
  {
    code: 'NS',
    name: 'Nova Scotia',
    taxes: [{ name: 'HST', rate: '14.000' }],
    depositCentsPerCan: 10,
    shippingCents: 1695,
    freeShippingThresholdCents: 5000,
    postalLetters: ['B'],
  },
  {
    code: 'ON',
    name: 'Ontario',
    taxes: [{ name: 'HST', rate: '13.000' }],
    depositCentsPerCan: 0,
    shippingCents: 1295,
    freeShippingThresholdCents: 3500,
    postalLetters: ['K', 'L', 'M', 'N', 'P'],
  },
  {
    code: 'QC',
    name: 'Quebec',
    taxes: [
      { name: 'GST', rate: '5.000' },
      { name: 'QST', rate: '9.975' },
    ],
    depositCentsPerCan: 10,
    shippingCents: 1295,
    freeShippingThresholdCents: 3500,
    postalLetters: ['G', 'H', 'J'],
  },
];


const PROVINCE_BY_CODE = new Map<string, ProvinceSeed>(PROVINCES.map((p) => [p.code, p]));

export function findProvince(code: string): ProvinceSeed | undefined {
  return PROVINCE_BY_CODE.get(code);
}

export function provinceName(code: ProvinceCode): string {
  const found = PROVINCE_BY_CODE.get(code);
  if (!found) throw new Error(`unknown province ${code}`);
  return found.name;
}

export const DEFAULT_PROVINCE: ProvinceCode = 'ON';

export type Cadence = 'monthly' | 'bimonthly';

export interface PlanSeed {
  readonly name: string;
  readonly label: string;
  readonly cadence: Cadence;
  /** The plan's box, as cans per flavour in seed order. */
  readonly box: ReadonlyArray<{ readonly flavour: FlavourSlug; readonly quantity: number }>;
}


function singleFlavourBox(flavour: FlavourSlug) {
  return [{ flavour, quantity: 12 }] as const;
}

const DISCOVERY_BOX = [
  { flavour: 'guava-lime', quantity: 4 },
  { flavour: 'yuzu-ginger', quantity: 4 },
  { flavour: 'passionfruit-basil', quantity: 4 },
] as const;

export const PLANS: readonly PlanSeed[] = [
  {
    name: 'ceibo-guava-lime-monthly',
    label: 'Guava & Lime box',
    cadence: 'monthly',
    box: singleFlavourBox('guava-lime'),
  },
  {
    name: 'ceibo-guava-lime-bimonthly',
    label: 'Guava & Lime box',
    cadence: 'bimonthly',
    box: singleFlavourBox('guava-lime'),
  },
  {
    name: 'ceibo-yuzu-ginger-monthly',
    label: 'Yuzu Ginger box',
    cadence: 'monthly',
    box: singleFlavourBox('yuzu-ginger'),
  },
  {
    name: 'ceibo-yuzu-ginger-bimonthly',
    label: 'Yuzu Ginger box',
    cadence: 'bimonthly',
    box: singleFlavourBox('yuzu-ginger'),
  },
  {
    name: 'ceibo-passionfruit-basil-monthly',
    label: 'Passionfruit Basil box',
    cadence: 'monthly',
    box: singleFlavourBox('passionfruit-basil'),
  },
  {
    name: 'ceibo-passionfruit-basil-bimonthly',
    label: 'Passionfruit Basil box',
    cadence: 'bimonthly',
    box: singleFlavourBox('passionfruit-basil'),
  },
  {
    name: 'ceibo-discovery-monthly',
    label: 'Discovery box',
    cadence: 'monthly',
    box: DISCOVERY_BOX,
  },
  {
    name: 'ceibo-discovery-bimonthly',
    label: 'Discovery box',
    cadence: 'bimonthly',
    box: DISCOVERY_BOX,
  },
];

export const KILLBILL_PRODUCT = 'ceibo-box';

const PLAN_BY_NAME = new Map<string, PlanSeed>(PLANS.map((p) => [p.name, p]));

export function findPlan(name: string): PlanSeed | undefined {
  return PLAN_BY_NAME.get(name);
}

export const CRATE_SIZE = 12;
export const DROP_HOLD_LIMIT = 6;

export interface StockistSeed {
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly province: string;
  readonly lat: number;
  readonly lng: number;
}

export const STOCKISTS: readonly StockistSeed[] = [
  {
    name: 'Epicerie Feuille Verte',
    address: '210 avenue du Parc, Montreal QC',
    city: 'Montreal',
    province: 'QC',
    lat: 45.5231,
    lng: -73.5817,
  },
  {
    name: 'Marche du Fleuve',
    address: '15 rue du Quai, Quebec City QC',
    city: 'Quebec City',
    province: 'QC',
    lat: 46.8123,
    lng: -71.2145,
  },
  {
    name: 'Canopy Grocer',
    address: '300 Queen Street West, Toronto ON',
    city: 'Toronto',
    province: 'ON',
    lat: 43.6532,
    lng: -79.3832,
  },
  {
    name: 'Riverbend Pantry',
    address: '88 Bank Street, Ottawa ON',
    city: 'Ottawa',
    province: 'ON',
    lat: 45.4215,
    lng: -75.6972,
  },
  {
    name: 'Orchard Row Market',
    address: '1500 Barrington Street, Halifax NS',
    city: 'Halifax',
    province: 'NS',
    lat: 44.6488,
    lng: -63.5752,
  },
  {
    name: 'Night Sky Provisions',
    address: '120 Stephen Avenue, Calgary AB',
    city: 'Calgary',
    province: 'AB',
    lat: 51.0447,
    lng: -114.0719,
  },
  {
    name: 'Cedar & Salt',
    address: '455 Main Street, Vancouver BC',
    city: 'Vancouver',
    province: 'BC',
    lat: 49.2827,
    lng: -123.1207,
  },
];

/** Every Canadian province and territory code accepted on a retailer application. */
export const CANADIAN_REGION_CODES: readonly string[] = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
];
