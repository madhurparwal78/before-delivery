import type { Category } from '../shared/categories.js';
import { normaliseName } from '../shared/normalise.js';
import type { CarryMode, ListState } from '../shared/types.js';
import { config } from './config.js';
import { transaction, type Db } from './db.js';
import { hashPassphrase } from './sessions.js';

const PASSPHRASE = 'switchback-ridge-47';

interface SeedItem {
  name: string;
  category: Category;
  weightGrams: number;
  unitsOwned: number;
  priceCents: number | null;
  notes: string;
}

const ITEMS: SeedItem[] = [
  { name: 'Silnylon tarp', category: 'Shelter', weightGrams: 482, unitsOwned: 1, priceCents: 18900, notes: 'Seam-sealed in March; patch near the ridgeline' },
  { name: 'Trekking pole tent', category: 'Shelter', weightGrams: 765, unitsOwned: 1, priceCents: 41000, notes: '' },
  { name: '20F down quilt', category: 'Sleep', weightGrams: 595, unitsOwned: 1, priceCents: 34000, notes: 'Warranty claim still open' },
  { name: 'Inflatable pad', category: 'Sleep', weightGrams: 354, unitsOwned: 1, priceCents: 16000, notes: '' },
  { name: 'Frameless pack 40L', category: 'Pack', weightGrams: 612, unitsOwned: 1, priceCents: 22500, notes: '' },
  { name: 'Titanium pot 750', category: 'Kitchen', weightGrams: 103, unitsOwned: 1, priceCents: 4500, notes: '' },
  { name: 'Canister stove', category: 'Kitchen', weightGrams: 73, unitsOwned: 1, priceCents: 6000, notes: '' },
  { name: 'Fuel canister 110', category: 'Kitchen', weightGrams: 200, unitsOwned: 3, priceCents: 750, notes: '' },
  { name: 'Squeeze filter', category: 'Water', weightGrams: 85, unitsOwned: 1, priceCents: 3800, notes: '' },
  { name: 'Smart water bottle 1L', category: 'Water', weightGrams: 37, unitsOwned: 2, priceCents: 250, notes: '' },
  { name: 'Rain jacket', category: 'Clothing', weightGrams: 198, unitsOwned: 1, priceCents: 23000, notes: '' },
  { name: 'Fleece hoodie', category: 'Clothing', weightGrams: 290, unitsOwned: 1, priceCents: 9500, notes: '' },
  { name: 'Trail runners', category: 'Clothing', weightGrams: 640, unitsOwned: 1, priceCents: 14000, notes: '' },
  { name: 'Camp sandals', category: 'Clothing', weightGrams: 210, unitsOwned: 1, priceCents: 3500, notes: 'Leave home for desert sections' },
  { name: 'Liner socks', category: 'Clothing', weightGrams: 34, unitsOwned: 3, priceCents: 1800, notes: '' },
  { name: 'Headlamp', category: 'Electronics', weightGrams: 56, unitsOwned: 1, priceCents: 4995, notes: 'Bought used from a friend' },
  { name: 'Power bank 10000', category: 'Electronics', weightGrams: 180, unitsOwned: 1, priceCents: 5500, notes: '' },
  { name: 'First aid kit', category: 'Essentials', weightGrams: 110, unitsOwned: 1, priceCents: null, notes: '' },
  { name: 'Trowel', category: 'Hygiene', weightGrams: 17, unitsOwned: 1, priceCents: 2000, notes: '' },
  { name: 'Dinner ration', category: 'Food', weightGrams: 180, unitsOwned: 6, priceCents: null, notes: '' },
];

interface SeedLine {
  item: string;
  quantity: number;
  mode: CarryMode;
}

interface SeedList {
  name: string;
  state: ListState;
  lines: SeedLine[];
}

const base = (item: string, quantity = 1): SeedLine => ({ item, quantity, mode: 'base' });
const worn = (item: string, quantity = 1): SeedLine => ({ item, quantity, mode: 'worn' });
const consumable = (item: string, quantity = 1): SeedLine => ({ item, quantity, mode: 'consumable' });

/** Oldest first: the seed inserts in this order so Trips lists newest first. */
const LISTS: SeedList[] = [
  {
    name: 'Winter overnight',
    state: 'walked',
    lines: [
      base('Trekking pole tent'),
      base('20F down quilt'),
      base('Inflatable pad'),
      base('Frameless pack 40L'),
      base('Fleece hoodie'),
    ],
  },
  {
    name: 'Shoulder-season loop',
    state: 'packed',
    lines: [
      base('Trekking pole tent'),
      base('20F down quilt'),
      base('Inflatable pad'),
      base('Frameless pack 40L'),
      base('Fleece hoodie'),
      base('Rain jacket'),
      base('Headlamp'),
      base('Power bank 10000'),
      base('Squeeze filter'),
      worn('Trail runners'),
    ],
  },
  {
    name: 'Desert section',
    state: 'planning',
    lines: [
      base('Silnylon tarp'),
      base('20F down quilt'),
      base('Inflatable pad'),
      base('Frameless pack 40L'),
      base('Titanium pot 750'),
      base('Canister stove'),
      base('Squeeze filter'),
      base('Smart water bottle 1L', 2),
      base('Rain jacket'),
      base('Headlamp'),
      base('First aid kit'),
      base('Trowel'),
      worn('Trail runners'),
      worn('Liner socks', 2),
      consumable('Fuel canister 110'),
      consumable('Dinner ration', 4),
    ],
  },
];

async function seedProfile(db: Db, displayName: string, goalGrams: number, timeZone: string, paperSize: string): Promise<void> {
  await db.query(
    `INSERT INTO profile (display_name, unit, goal_grams, time_zone, paper_size, passphrase_hash)
     VALUES ($1, 'g', $2, $3, $4, $5)`,
    [displayName, goalGrams, timeZone, paperSize, hashPassphrase(PASSPHRASE)],
  );
}

/** Loads the seed named by SKINOUT_SEED when no hiker profile exists yet. */
export async function loadSeed(): Promise<void> {
  await transaction(async (db) => {
    const existing = await db.query('SELECT 1 FROM profile WHERE only_row');
    if (existing.rows.length > 0) return;
    if (config.seed === 'none') {
      await seedProfile(db, 'Hiker', 4500, 'UTC', 'A4');
      return;
    }
    await seedProfile(db, 'Rowan Tamsin', 4500, 'America/Denver', 'Letter');
    const itemIds = new Map<string, string>();
    for (const item of ITEMS) {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO items (name, normalised_name, category, weight_grams, units_owned, price_cents, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          item.name,
          normaliseName(item.name),
          item.category,
          item.weightGrams,
          item.unitsOwned,
          item.priceCents,
          item.notes,
        ],
      );
      itemIds.set(item.name, (inserted.rows[0] as { id: string }).id);
    }
    for (const list of LISTS) {
      const inserted = await db.query<{ id: string }>(
        'INSERT INTO trip_lists (name, state) VALUES ($1, $2) RETURNING id',
        [list.name, list.state],
      );
      const listId = (inserted.rows[0] as { id: string }).id;
      for (const line of list.lines) {
        const itemId = itemIds.get(line.item) as string;
        const seedItem = ITEMS.find((candidate) => candidate.name === line.item) as SeedItem;
        const frozen = list.state === 'planning' ? [null, null] : [seedItem.name, seedItem.weightGrams];
        await db.query(
          `INSERT INTO lines (list_id, item_id, quantity, mode, frozen_name, frozen_weight_grams)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [listId, itemId, line.quantity, line.mode, frozen[0], frozen[1]],
        );
      }
    }
  });
}
