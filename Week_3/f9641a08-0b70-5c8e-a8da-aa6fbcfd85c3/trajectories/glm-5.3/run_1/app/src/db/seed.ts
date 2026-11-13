/** Seed data: applied whenever the database has no catalogue. Everything invented. */

export type SeedVariant = {
  sku: string; colour: string; colourSlug: string; size: string; sizeSlug: string;
  height: number; width: number; depth: number; weight: number; price: number; compareAt: number | null;
  position: number;
};

export type SeedProduct = {
  slug: string; name: string; category: string; material: string; description: string;
  publishedAt: string; colours: string[]; sizes: { code: string; slug: string; label: string; dims: [number, number, number]; weight: number; price: number; compareAt: number | null }[];
  variants: SeedVariant[];
};

const COLOUR_CODES: Record<string, string> = {
  'Graphite': 'GRA', 'Sage': 'SAG', 'Signal Red': 'RED', 'Silver': 'SIL', 'Navy': 'NAV',
  'Teal': 'TEA', 'Yellow': 'YEL', 'Blue': 'BLU', 'Sand': 'SND', 'Tan': 'TAN', 'Black': 'BLK', 'Grey': 'GRY',
};

export function colourCode(name: string): string {
  return COLOUR_CODES[name] ?? name.slice(0, 3).toUpperCase();
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

type ProductSpec = {
  code: string; name: string; slug: string; category: string; material: string;
  colours: string[]; sizes: { size: string; code: string; slug: string; label: string; dims: [number, number, number]; weight: number; price: number; compareAt: number | null }[];
  publishedAt: string;
  description: string;
};

const PRODUCTS: ProductSpec[] = [
  {
    code: 'MER', name: 'Meridian Spinner', slug: 'meridian-spinner', category: 'luggage', material: 'Polycarbonate',
    colours: ['Graphite', 'Sage', 'Signal Red'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A four-wheel cabin case with a sealed shell and a stowaway handle.',
    sizes: [
      { size: 'C', code: 'C', slug: 'cabin', label: 'Cabin', dims: [55, 40, 20], weight: 2.9, price: 12499, compareAt: 14999 },
      { size: 'M', code: 'M', slug: 'check-in-medium', label: 'Check-in Medium', dims: [68, 46, 28], weight: 3.8, price: 15999, compareAt: null },
      { size: 'L', code: 'L', slug: 'check-in-large', label: 'Check-in Large', dims: [77, 52, 31], weight: 4.6, price: 18999, compareAt: null },
    ],
  },
  {
    code: 'ATL', name: 'Atlas Aluminium', slug: 'atlas-aluminium', category: 'luggage', material: 'Aluminium',
    colours: ['Silver', 'Graphite'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A riveted aluminium trunk case with corner guards.',
    sizes: [
      { size: 'C', code: 'C', slug: 'cabin', label: 'Cabin', dims: [56, 40, 23], weight: 4.4, price: 24999, compareAt: null },
      { size: 'M', code: 'M', slug: 'check-in-medium', label: 'Check-in Medium', dims: [69, 47, 27], weight: 5.6, price: 29999, compareAt: null },
    ],
  },
  {
    code: 'HAR', name: 'Harbour Softside', slug: 'harbour-softside', category: 'luggage', material: 'Recycled nylon',
    colours: ['Navy', 'Teal'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A soft-sided spinner in recycled nylon with a full-length zip.',
    sizes: [
      { size: 'C', code: 'C', slug: 'cabin', label: 'Cabin', dims: [54, 38, 22], weight: 2.4, price: 8999, compareAt: null },
      { size: 'M', code: 'M', slug: 'check-in-medium', label: 'Check-in Medium', dims: [67, 44, 29], weight: 3.3, price: 10999, compareAt: null },
    ],
  },
  {
    code: 'KES', name: 'Kestrel Trunk', slug: 'kestrel-trunk', category: 'luggage', material: 'Polypropylene',
    colours: ['Yellow', 'Blue'],
    publishedAt: '2026-10-20T00:00:00Z',
    description: 'A deep polypropylene trunk built for long-haul holds.',
    sizes: [
      { size: 'L', code: 'L', slug: 'check-in-large', label: 'Check-in Large', dims: [80, 50, 35], weight: 5.1, price: 21499, compareAt: null },
    ],
  },
  {
    code: 'LRK', name: 'Lark Underseat', slug: 'lark-underseat', category: 'luggage', material: 'Polycarbonate',
    colours: ['Graphite', 'Signal Red'],
    publishedAt: '2026-10-10T00:00:00Z',
    description: 'A small hard case sized for the seat pocket.',
    sizes: [
      { size: 'U', code: 'U', slug: 'underseat', label: 'Underseat', dims: [40, 30, 18], weight: 2.1, price: 7999, compareAt: null },
    ],
  },
  {
    code: 'TRN', name: 'Transit Backpack', slug: 'transit-backpack', category: 'backpacks', material: 'Recycled nylon',
    colours: ['Graphite', 'Sage', 'Blue'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A cabin-sized backpack with a padded laptop sleeve.',
    sizes: [
      { size: 'C', code: 'C', slug: 'cabin', label: 'Cabin', dims: [48, 32, 20], weight: 1.3, price: 6499, compareAt: null },
    ],
  },
  {
    code: 'RDG', name: 'Ridge Roll-top', slug: 'ridge-roll-top', category: 'backpacks', material: 'Waxed canvas',
    colours: ['Sand', 'Graphite'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A roll-top rucksack in waxed canvas.',
    sizes: [
      { size: 'U', code: 'U', slug: 'underseat', label: 'Underseat', dims: [42, 30, 15], weight: 1.1, price: 4999, compareAt: 5999 },
    ],
  },
  {
    code: 'CRR', name: 'Courier Daypack', slug: 'courier-daypack', category: 'backpacks', material: 'Recycled nylon',
    colours: ['Teal', 'Signal Red'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A small daypack with a quick clasp.',
    sizes: [
      { size: 'U', code: 'U', slug: 'underseat', label: 'Underseat', dims: [40, 28, 14], weight: 0.8, price: 3999, compareAt: null },
    ],
  },
  {
    code: 'WKT', name: 'Weekender Tote', slug: 'weekender-tote', category: 'totes', material: 'Waxed canvas',
    colours: ['Sand', 'Navy'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'An overnight duffel-tote in waxed canvas.',
    sizes: [
      { size: 'U', code: 'U', slug: 'underseat', label: 'Underseat', dims: [45, 32, 20], weight: 1.0, price: 5499, compareAt: null },
    ],
  },
  {
    code: 'MKT', name: 'Market Tote', slug: 'market-tote', category: 'totes', material: 'Cotton canvas',
    colours: ['Sand', 'Black'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A plain cotton canvas tote.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [38, 40, 12], weight: 0.4, price: 2499, compareAt: null },
    ],
  },
  {
    code: 'FLD', name: 'Field Duffel', slug: 'field-duffel', category: 'totes', material: 'Waxed canvas',
    colours: ['Graphite', 'Sage'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A wide duffel that sits flat in the hold.',
    sizes: [
      { size: 'C', code: 'C', slug: 'cabin', label: 'Cabin', dims: [30, 52, 28], weight: 1.2, price: 7499, compareAt: null },
    ],
  },
  {
    code: 'PSW', name: 'Passport Wallet', slug: 'passport-wallet', category: 'wallets', material: 'Leather',
    colours: ['Tan', 'Black'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A leather folio for passport and cards.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [14, 10, 2], weight: 0.1, price: 2999, compareAt: null },
    ],
  },
  {
    code: 'CSL', name: 'Card Sleeve', slug: 'card-sleeve', category: 'wallets', material: 'Leather',
    colours: ['Tan', 'Black'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A slim leather card sleeve.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [10, 7, 1], weight: 0.05, price: 1499, compareAt: null },
    ],
  },
  {
    code: 'PCK', name: 'Fold Packing Cubes', slug: 'packing-cubes', category: 'accessories', material: 'Recycled nylon',
    colours: ['Sage', 'Graphite'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A set of three folding cubes.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [35, 25, 10], weight: 0.3, price: 1245, compareAt: null },
    ],
  },
  {
    code: 'TAG', name: 'Tag Pair', slug: 'tag-pair', category: 'accessories', material: 'Leather',
    colours: ['Tan'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'Two leather luggage tags.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [11, 6, 1], weight: 0.05, price: 980, compareAt: null },
    ],
  },
  {
    code: 'LCK', name: 'Travel Lock', slug: 'travel-lock', category: 'accessories', material: 'Zinc alloy',
    colours: ['Black'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A resettable zinc alloy padlock.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [6, 3, 1], weight: 0.1, price: 1199, compareAt: null },
    ],
  },
  {
    code: 'PLW', name: 'Neck Pillow', slug: 'neck-pillow', category: 'accessories', material: 'Memory foam',
    colours: ['Grey'],
    publishedAt: '2026-09-01T00:00:00Z',
    description: 'A memory foam neck pillow.',
    sizes: [
      { size: 'O', code: 'O', slug: 'one-size', label: 'One size', dims: [30, 28, 12], weight: 0.3, price: 1799, compareAt: null },
    ],
  },
];

export const SEED_STOCK_EXCEPTIONS: Record<string, number> = {
  'MER-SAG-M': 2,
  'MER-RED-C': 1,
  'HAR-NAV-C': 5,
  'ATL-SIL-M': 0,
  'KES-YEL-L': 3,
};

export const SEED_STOCK_DEFAULT = 8;

export function seedProducts(): { product: ProductSpec; variants: SeedVariant[] }[] {
  return PRODUCTS.map((spec) => {
    const variants: SeedVariant[] = [];
    let position = 1;
    for (const colour of spec.colours) {
      for (const size of spec.sizes) {
        variants.push({
          sku: `${spec.code}-${colourCode(colour)}-${size.code}`,
          colour,
          colourSlug: slugify(colour),
          size: size.label,
          sizeSlug: size.slug,
          height: size.dims[0],
          width: size.dims[1],
          depth: size.dims[2],
          weight: size.weight,
          price: size.price,
          compareAt: size.compareAt,
          position: position++,
        });
      }
    }
    return { product: spec, variants };
  });
}

export const SEED_ACCOUNTS = [
  { name: 'Asha Menon', email: 'asha@roamhouse.example', password: 'travel-asha-01', role: 'customer' },
  { name: 'Dev Raman', email: 'dev@roamhouse.example', password: 'travel-dev-02', role: 'customer' },
  { name: 'Priya Kulkarni', email: 'ops@roamhouse.example', password: 'ops-priya-03', role: 'operations' },
  { name: 'Tomas Ferreira', email: 'support@roamhouse.example', password: 'support-tomas-04', role: 'support' },
];

export const SEED_ADDRESSES = [
  {
    label: 'Home', name: 'Asha Menon', line1: '14 Carter Road, Bandra West', line2: '', city: 'Mumbai',
    state: 'Maharashtra', postcode: '400050', phone: '9820012345',
  },
  {
    label: 'Office', name: 'Asha Menon', line1: '3rd Floor, 22 Residency Road', line2: '', city: 'Bengaluru',
    state: 'Karnataka', postcode: '560025', phone: '9820012345',
  },
];

export const SEED_DISCOUNT_CODES = [
  { code: 'TRAVEL10', kind: 'percent', value: 10, collection: null, minimum: 0, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-12-31T23:59:59Z', usageLimit: null, used: 0 },
  { code: 'SPRING15', kind: 'percent', value: 15, collection: null, minimum: 0, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-05-31T23:59:59Z', usageLimit: null, used: 0 },
  { code: 'DUFFEL20', kind: 'percent', value: 20, collection: 'totes', minimum: 0, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-12-31T23:59:59Z', usageLimit: null, used: 0 },
  { code: 'BIG1500', kind: 'fixed', value: 1500, collection: null, minimum: 20000, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-12-31T23:59:59Z', usageLimit: null, used: 0 },
  { code: 'LAUNCH25', kind: 'percent', value: 25, collection: null, minimum: 0, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-12-31T23:59:59Z', usageLimit: 50, used: 50 },
  { code: 'SAVE300', kind: 'fixed', value: 300, collection: null, minimum: 0, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-12-31T23:59:59Z', usageLimit: null, used: 0 },
];

export const SEED_GIFT_CARDS = [
  { code: 'RHGC-2000-ALFA', balance: 2000 },
  { code: 'RHGC-0500-BRVO', balance: 500 },
];
