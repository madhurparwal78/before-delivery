import { randomUUID } from 'node:crypto';
import { COLOUR_CODES, GALLERY_STUDIES, SIZE_ORDER } from '../domain/constants';
import { hashPassword } from '../domain/passwords';
import { slugify } from '../domain/rules';
import { writeMovement } from '../domain/stock';
import { Db, tx } from './pool';

type SeedSize = {
  code: 'C' | 'M' | 'L' | 'U' | 'O';
  h: number;
  w: number;
  d: number;
  kg: number;
  price: number;
  compareAt: number | null;
};

type SeedProduct = {
  code: string;
  slug: string;
  name: string;
  category: string;
  material: string;
  description: string;
  colours: string[];
  sizes: SeedSize[];
  publishedAt: string;
};

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    code: 'MER',
    slug: 'meridian-spinner',
    name: 'Meridian Spinner',
    category: 'luggage',
    material: 'Polycarbonate',
    description: 'A hard-shell spinner suitcase measured with wheels and the stowed handle counted.',
    colours: ['Graphite', 'Sage', 'Signal Red'],
    sizes: [
      { code: 'C', h: 55, w: 40, d: 20, kg: 2.9, price: 12499, compareAt: 14999 },
      { code: 'M', h: 68, w: 46, d: 28, kg: 3.8, price: 15999, compareAt: null },
      { code: 'L', h: 77, w: 52, d: 31, kg: 4.6, price: 18999, compareAt: null }
    ],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'ATL',
    slug: 'atlas-aluminium',
    name: 'Atlas Aluminium',
    category: 'luggage',
    material: 'Aluminium',
    description: 'A riveted aluminium case for long trips, with recessed latches and a stowed handle.',
    colours: ['Silver', 'Graphite'],
    sizes: [
      { code: 'C', h: 56, w: 40, d: 23, kg: 4.4, price: 24999, compareAt: null },
      { code: 'M', h: 69, w: 47, d: 27, kg: 5.6, price: 29999, compareAt: null }
    ],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'HAR',
    slug: 'harbour-softside',
    name: 'Harbour Softside',
    category: 'luggage',
    material: 'Recycled nylon',
    description: 'A soft-side suitcase in recycled nylon, light enough for a cabin frame.',
    colours: ['Navy', 'Teal'],
    sizes: [
      { code: 'C', h: 54, w: 38, d: 22, kg: 2.4, price: 8999, compareAt: null },
      { code: 'M', h: 67, w: 44, d: 29, kg: 3.3, price: 10999, compareAt: null }
    ],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'KES',
    slug: 'kestrel-trunk',
    name: 'Kestrel Trunk',
    category: 'luggage',
    material: 'Polypropylene',
    description: 'A deep check-in trunk in polypropylene for the long haul.',
    colours: ['Yellow', 'Blue'],
    sizes: [{ code: 'L', h: 80, w: 50, d: 35, kg: 5.1, price: 21499, compareAt: null }],
    publishedAt: '2026-10-20T00:00:00Z'
  },
  {
    code: 'LRK',
    slug: 'lark-underseat',
    name: 'Lark Underseat',
    category: 'luggage',
    material: 'Polycarbonate',
    description: 'An underseat case that slides below the row in front of you.',
    colours: ['Graphite', 'Signal Red'],
    sizes: [{ code: 'U', h: 40, w: 30, d: 18, kg: 2.1, price: 7999, compareAt: null }],
    publishedAt: '2026-10-10T00:00:00Z'
  },
  {
    code: 'TRN',
    slug: 'transit-backpack',
    name: 'Transit Backpack',
    category: 'backpacks',
    material: 'Recycled nylon',
    description: 'A cabin-sized backpack with a padded laptop sleeve and a trolley pass-through.',
    colours: ['Graphite', 'Sage', 'Blue'],
    sizes: [{ code: 'C', h: 48, w: 32, d: 20, kg: 1.3, price: 6499, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'RDG',
    slug: 'ridge-roll-top',
    name: 'Ridge Roll-top',
    category: 'backpacks',
    material: 'Waxed canvas',
    description: 'A waxed-canvas roll-top rucksack that cinches down to underseat size.',
    colours: ['Sand', 'Graphite'],
    sizes: [{ code: 'U', h: 42, w: 30, d: 15, kg: 1.1, price: 4999, compareAt: 5999 }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'CRR',
    slug: 'courier-daypack',
    name: 'Courier Daypack',
    category: 'backpacks',
    material: 'Recycled nylon',
    description: 'A slim daypack for a city stopover.',
    colours: ['Teal', 'Signal Red'],
    sizes: [{ code: 'U', h: 40, w: 28, d: 14, kg: 0.8, price: 3999, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'WKT',
    slug: 'weekender-tote',
    name: 'Weekender Tote',
    category: 'totes',
    material: 'Waxed canvas',
    description: 'A two-night tote in waxed canvas with a wide opening.',
    colours: ['Sand', 'Navy'],
    sizes: [{ code: 'U', h: 45, w: 32, d: 20, kg: 1.0, price: 5499, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'MKT',
    slug: 'market-tote',
    name: 'Market Tote',
    category: 'totes',
    material: 'Cotton canvas',
    description: 'A flat cotton-canvas tote that folds into a pocket.',
    colours: ['Sand', 'Black'],
    sizes: [{ code: 'O', h: 38, w: 40, d: 12, kg: 0.4, price: 2499, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'FLD',
    slug: 'field-duffel',
    name: 'Field Duffel',
    category: 'totes',
    material: 'Waxed canvas',
    description: 'A waxed-canvas duffel, cabin sized on its side.',
    colours: ['Graphite', 'Sage'],
    sizes: [{ code: 'C', h: 30, w: 52, d: 28, kg: 1.2, price: 7499, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'PSW',
    slug: 'passport-wallet',
    name: 'Passport Wallet',
    category: 'wallets',
    material: 'Leather',
    description: 'A leather passport wallet with a boarding-pass pocket.',
    colours: ['Tan', 'Black'],
    sizes: [{ code: 'O', h: 14, w: 10, d: 2, kg: 0.1, price: 2999, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'CSL',
    slug: 'card-sleeve',
    name: 'Card Sleeve',
    category: 'wallets',
    material: 'Leather',
    description: 'A four-card leather sleeve that stays flat in a pocket.',
    colours: ['Tan', 'Black'],
    sizes: [{ code: 'O', h: 10, w: 7, d: 1, kg: 0.05, price: 1499, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'PCK',
    slug: 'packing-cubes',
    name: 'Fold Packing Cubes',
    category: 'accessories',
    material: 'Recycled nylon',
    description: 'A set of three packing cubes in recycled nylon.',
    colours: ['Sage', 'Graphite'],
    sizes: [{ code: 'O', h: 35, w: 25, d: 10, kg: 0.3, price: 1245, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'TAG',
    slug: 'tag-pair',
    name: 'Tag Pair',
    category: 'accessories',
    material: 'Leather',
    description: 'Two leather luggage tags with hidden address cards.',
    colours: ['Tan'],
    sizes: [{ code: 'O', h: 11, w: 6, d: 1, kg: 0.05, price: 980, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'LCK',
    slug: 'travel-lock',
    name: 'Travel Lock',
    category: 'accessories',
    material: 'Zinc alloy',
    description: 'A zinc-alloy combination lock for zip pulls.',
    colours: ['Black'],
    sizes: [{ code: 'O', h: 6, w: 3, d: 1, kg: 0.1, price: 1199, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    code: 'PLW',
    slug: 'neck-pillow',
    name: 'Neck Pillow',
    category: 'accessories',
    material: 'Memory foam',
    description: 'A memory-foam neck pillow that clips to a handle.',
    colours: ['Grey'],
    sizes: [{ code: 'O', h: 30, w: 28, d: 12, kg: 0.3, price: 1799, compareAt: null }],
    publishedAt: '2026-09-01T00:00:00Z'
  }
];

const STOCK_EXCEPTIONS: Record<string, number> = {
  'MER-SAG-M': 2,
  'MER-RED-C': 1,
  'HAR-NAV-C': 5,
  'ATL-SIL-M': 0,
  'KES-YEL-L': 3
};

const SEED_USERS = [
  { name: 'Asha Menon', email: 'asha@roamhouse.example', password: 'travel-asha-01', role: 'customer' },
  { name: 'Dev Raman', email: 'dev@roamhouse.example', password: 'travel-dev-02', role: 'customer' },
  { name: 'Priya Kulkarni', email: 'ops@roamhouse.example', password: 'ops-priya-03', role: 'operations' },
  { name: 'Tomas Ferreira', email: 'support@roamhouse.example', password: 'support-tomas-04', role: 'support' }
];

const SEED_ADDRESSES = [
  {
    email: 'asha@roamhouse.example',
    label: 'Home',
    name: 'Asha Menon',
    line1: '14 Carter Road',
    line2: 'Bandra West',
    city: 'Mumbai',
    state: 'Maharashtra',
    postcode: '400050',
    phone: '9820012345'
  },
  {
    email: 'asha@roamhouse.example',
    label: 'Office',
    name: 'Asha Menon',
    line1: '3rd Floor, 22 Residency Road',
    line2: '',
    city: 'Bengaluru',
    state: 'Karnataka',
    postcode: '560025',
    phone: '9820012345'
  }
];

const SEED_CODES = [
  {
    code: 'TRAVEL10',
    kind: 'percent',
    value: 10,
    collection: null,
    minimum: 0,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2027-12-31T23:59:59+05:30',
    usage_limit: null,
    used: 0
  },
  {
    code: 'SPRING15',
    kind: 'percent',
    value: 15,
    collection: null,
    minimum: 0,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2026-05-31T23:59:00+05:30',
    usage_limit: null,
    used: 0
  },
  {
    code: 'DUFFEL20',
    kind: 'percent',
    value: 20,
    collection: 'totes',
    minimum: 0,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2027-12-31T23:59:59+05:30',
    usage_limit: null,
    used: 0
  },
  {
    code: 'BIG1500',
    kind: 'fixed',
    value: 1500,
    collection: null,
    minimum: 20000,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2027-12-31T23:59:59+05:30',
    usage_limit: null,
    used: 0
  },
  {
    code: 'LAUNCH25',
    kind: 'percent',
    value: 25,
    collection: null,
    minimum: 0,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2027-12-31T23:59:59+05:30',
    usage_limit: 50,
    used: 50
  },
  {
    code: 'SAVE300',
    kind: 'fixed',
    value: 300,
    collection: null,
    minimum: 0,
    starts_at: '2026-01-01T00:00:00+05:30',
    ends_at: '2027-12-31T23:59:59+05:30',
    usage_limit: null,
    used: 0
  }
];

const SEED_GIFT_CARDS = [
  { code: 'RHGC-2000-ALFA', balance: 2000 },
  { code: 'RHGC-0500-BRVO', balance: 500 }
];

function sizeOf(code: string): { label: string; slug: string } {
  const found = SIZE_ORDER.find((size) => size.code === code);
  if (found === undefined) throw new Error(`unknown size code ${code}`);
  return { label: found.label, slug: found.slug };
}

async function seedUsers(client: Db): Promise<void> {
  for (const user of SEED_USERS) {
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), user.name, user.email, hashPassword(user.password), user.role]
    );
  }
  for (const [index, address] of SEED_ADDRESSES.entries()) {
    const owner = await client.one<{ id: string }>('SELECT id FROM users WHERE email = $1', [address.email]);
    if (owner === null) continue;
    const existing = await client.one<{ id: string }>(
      'SELECT id FROM addresses WHERE user_id = $1 AND label = $2',
      [owner.id, address.label]
    );
    if (existing !== null) continue;
    await client.query(
      `INSERT INTO addresses (id, user_id, label, name, line1, line2, city, state, postcode, phone, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        owner.id,
        address.label,
        address.name,
        address.line1,
        address.line2,
        address.city,
        address.state,
        address.postcode,
        address.phone,
        index + 1
      ]
    );
  }
}

async function seedCodes(client: Db): Promise<void> {
  for (const code of SEED_CODES) {
    await client.query(
      `INSERT INTO discount_codes (code, kind, value, collection, minimum, starts_at, ends_at, usage_limit, used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (code) DO NOTHING`,
      [
        code.code,
        code.kind,
        code.value,
        code.collection,
        code.minimum,
        code.starts_at,
        code.ends_at,
        code.usage_limit,
        code.used
      ]
    );
  }
  for (const card of SEED_GIFT_CARDS) {
    const existing = await client.one<{ code: string }>('SELECT code FROM gift_cards WHERE code = $1', [card.code]);
    if (existing !== null) continue;
    await client.query('INSERT INTO gift_cards (code) VALUES ($1)', [card.code]);
    const groupId = randomUUID();
    await client.query(
      `INSERT INTO gift_card_entries (group_id, code, account, amount, reason, ref)
       VALUES ($1, $2, 'issuance', $3, 'issued', $2), ($1, $2, 'card', $4, 'issued', $2)`,
      [groupId, card.code, -card.balance, card.balance]
    );
  }
}

async function seedCatalogue(client: Db): Promise<void> {
  for (const [rank, product] of SEED_PRODUCTS.entries()) {
    const productId = randomUUID();
    await client.query(
      `INSERT INTO products (id, slug, name, category, material, material_slug, description, status,
                             featured_rank, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, $9)`,
      [
        productId,
        product.slug,
        product.name,
        product.category,
        product.material,
        slugify(product.material),
        product.description,
        rank + 1,
        product.publishedAt
      ]
    );

    let position = 0;
    for (const colour of product.colours) {
      for (const size of product.sizes) {
        const sizeInfo = sizeOf(size.code);
        const sku = `${product.code}-${COLOUR_CODES[colour]}-${size.code}`;
        const variantId = randomUUID();
        position += 1;
        await client.query(
          `INSERT INTO variants (id, product_id, sku, colour, colour_slug, size, size_slug,
                                 height_cm, width_cm, depth_cm, weight_kg, price, compare_at, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            variantId,
            productId,
            sku,
            colour,
            slugify(colour),
            sizeInfo.label,
            sizeInfo.slug,
            size.h,
            size.w,
            size.d,
            size.kg,
            size.price,
            size.compareAt,
            position
          ]
        );
        const units = STOCK_EXCEPTIONS[sku] ?? 8;
        if (units > 0) {
          await writeMovement(client, variantId, 'stock_received', 'seed', 'bhiwandi', units);
        }
      }
      for (const [index, study] of GALLERY_STUDIES.entries()) {
        await client.query(
          `INSERT INTO product_images (id, product_id, colour, alt, position, content_type, study)
           VALUES ($1, $2, $3, $4, $5, 'image/svg+xml', $6)`,
          [randomUUID(), productId, colour, `${product.name} in ${colour}`, index + 1, study]
        );
      }
    }
  }
}

export async function seedIfEmpty(): Promise<boolean> {
  return tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(728413)');
    await seedUsers(client);
    await seedCodes(client);
    const existing = await client.one<{ id: string }>('SELECT id FROM products LIMIT 1');
    if (existing !== null) return false;
    await seedCatalogue(client);
    return true;
  });
}
