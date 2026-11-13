import type { Db } from './db.js';
import { hashPassphrase } from './sessions.js';

/**
 * Seed data. Loaded only when the database has no hiker profile. All people
 * and gear records are invented. A restart against an existing database
 * changes no data.
 */

const PASSPHRASE = 'switchback-ridge-47';

interface SeedItem {
  name: string;
  category: string;
  weightGrams: number;
  unitsOwned: number;
  priceCents: number | null;
  notes: string;
}

const CLOSET: SeedItem[] = [
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
  mode: 'base' | 'worn' | 'consumable';
}

interface SeedList {
  name: string;
  state: 'planning' | 'packed' | 'walked';
  lines: SeedLine[];
}

const LISTS: SeedList[] = [
  {
    name: 'Desert section',
    state: 'planning',
    lines: [
      { item: 'Silnylon tarp', quantity: 1, mode: 'base' },
      { item: '20F down quilt', quantity: 1, mode: 'base' },
      { item: 'Inflatable pad', quantity: 1, mode: 'base' },
      { item: 'Frameless pack 40L', quantity: 1, mode: 'base' },
      { item: 'Titanium pot 750', quantity: 1, mode: 'base' },
      { item: 'Canister stove', quantity: 1, mode: 'base' },
      { item: 'Squeeze filter', quantity: 1, mode: 'base' },
      { item: 'Smart water bottle 1L', quantity: 2, mode: 'base' },
      { item: 'Rain jacket', quantity: 1, mode: 'base' },
      { item: 'Headlamp', quantity: 1, mode: 'base' },
      { item: 'First aid kit', quantity: 1, mode: 'base' },
      { item: 'Trowel', quantity: 1, mode: 'base' },
      { item: 'Trail runners', quantity: 1, mode: 'worn' },
      { item: 'Liner socks', quantity: 2, mode: 'worn' },
      { item: 'Fuel canister 110', quantity: 1, mode: 'consumable' },
      { item: 'Dinner ration', quantity: 4, mode: 'consumable' },
    ],
  },
  {
    name: 'Shoulder-season loop',
    state: 'packed',
    lines: [
      { item: 'Trekking pole tent', quantity: 1, mode: 'base' },
      { item: '20F down quilt', quantity: 1, mode: 'base' },
      { item: 'Inflatable pad', quantity: 1, mode: 'base' },
      { item: 'Frameless pack 40L', quantity: 1, mode: 'base' },
      { item: 'Fleece hoodie', quantity: 1, mode: 'base' },
      { item: 'Rain jacket', quantity: 1, mode: 'base' },
      { item: 'Headlamp', quantity: 1, mode: 'base' },
      { item: 'Power bank 10000', quantity: 1, mode: 'base' },
      { item: 'Squeeze filter', quantity: 1, mode: 'base' },
      { item: 'Trail runners', quantity: 1, mode: 'worn' },
    ],
  },
  {
    name: 'Winter overnight',
    state: 'walked',
    lines: [
      { item: 'Trekking pole tent', quantity: 1, mode: 'base' },
      { item: '20F down quilt', quantity: 1, mode: 'base' },
      { item: 'Inflatable pad', quantity: 1, mode: 'base' },
      { item: 'Frameless pack 40L', quantity: 1, mode: 'base' },
      { item: 'Fleece hoodie', quantity: 1, mode: 'base' },
    ],
  },
];

/** Loads the chosen seed when the hiker profile is missing. */
export async function loadSeed(db: Db, seed: 'demo' | 'none'): Promise<void> {
  const existing = await db`SELECT id FROM hiker WHERE id = 1`;
  if (existing.length > 0) return;

  const displayName = seed === 'none' ? 'Hiker' : 'Rowan Tamsin';
  const goalGrams = 4500;
  const timeZone = seed === 'none' ? 'UTC' : 'America/Denver';
  const paperSize = seed === 'none' ? 'A4' : 'Letter';
  await db`INSERT INTO hiker (id, display_name, passphrase_hash, unit, goal_grams, time_zone, paper_size) VALUES (1, ${displayName}, ${hashPassphrase(PASSPHRASE)}, 'g', ${goalGrams}, ${timeZone}, ${paperSize})`;
  if (seed === 'none') return;

  const itemIdByName = new Map<string, string>();
  let index = 0;
  for (const item of CLOSET) {
    index += 1;
    const id = `item${String(index).padStart(3, '0')}`;
    itemIdByName.set(item.name, id);
    await db`INSERT INTO closet_items (id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version) VALUES (${id}, ${item.name}, ${item.category}, ${item.weightGrams}, ${item.unitsOwned}, 'active', ${item.priceCents}, ${item.notes}, NULL, 1)`;
  }

  let listIndex = 0;
  for (const list of LISTS) {
    listIndex += 1;
    const listId = `list${String(listIndex).padStart(3, '0')}`;
    await db`INSERT INTO lists (id, name, state, created_at) VALUES (${listId}, ${list.name}, ${list.state}, now() - ${`${listIndex} hours`}::interval)`;
    let position = 0;
    for (const line of list.lines) {
      position += 1;
      const item = CLOSET.find((candidate) => candidate.name === line.item)!;
      const lineId = `${listId}line${String(position).padStart(3, '0')}`;
      // Packed and walked lists start with frozen names and weights equal to
      // the closet values.
      await db`INSERT INTO lines (id, list_id, item_id, quantity, mode, name, unit_weight_grams, position) VALUES (${lineId}, ${listId}, ${itemIdByName.get(line.item)!}, ${line.quantity}, ${line.mode}, ${item.name}, ${item.weightGrams}, ${position})`;
    }
  }
}
