import { randomUUID } from 'node:crypto'
import type { CarryMode, Category, ListState } from '../shared/api-types'
import { normaliseName } from '../shared/names'
import { config } from './config'
import { transaction, query, type Db } from './db'
import { hashPassphrase } from './session'

/** The documented seed passphrase. */
const SEED_PASSPHRASE = 'switchback-ridge-47'

type GearSeed = [name: string, category: Category, grams: number, units: number, priceCents: number | null, notes: string]

const GEAR: GearSeed[] = [
  ['Silnylon tarp', 'Shelter', 482, 1, 18900, 'Seam-sealed in March; patch near the ridgeline'],
  ['Trekking pole tent', 'Shelter', 765, 1, 41000, ''],
  ['20F down quilt', 'Sleep', 595, 1, 34000, 'Warranty claim still open'],
  ['Inflatable pad', 'Sleep', 354, 1, 16000, ''],
  ['Frameless pack 40L', 'Pack', 612, 1, 22500, ''],
  ['Titanium pot 750', 'Kitchen', 103, 1, 4500, ''],
  ['Canister stove', 'Kitchen', 73, 1, 6000, ''],
  ['Fuel canister 110', 'Kitchen', 200, 3, 750, ''],
  ['Squeeze filter', 'Water', 85, 1, 3800, ''],
  ['Smart water bottle 1L', 'Water', 37, 2, 250, ''],
  ['Rain jacket', 'Clothing', 198, 1, 23000, ''],
  ['Fleece hoodie', 'Clothing', 290, 1, 9500, ''],
  ['Trail runners', 'Clothing', 640, 1, 14000, ''],
  ['Camp sandals', 'Clothing', 210, 1, 3500, 'Leave home for desert sections'],
  ['Liner socks', 'Clothing', 34, 3, 1800, ''],
  ['Headlamp', 'Electronics', 56, 1, 4995, 'Bought used from a friend'],
  ['Power bank 10000', 'Electronics', 180, 1, 5500, ''],
  ['First aid kit', 'Essentials', 110, 1, null, ''],
  ['Trowel', 'Hygiene', 17, 1, 2000, ''],
  ['Dinner ration', 'Food', 180, 6, null, ''],
]

type LineSeed = [item: string, quantity?: number, mode?: CarryMode]

const LISTS: { name: string; state: ListState; lines: LineSeed[] }[] = [
  {
    name: 'Winter overnight',
    state: 'walked',
    lines: [['Trekking pole tent'], ['20F down quilt'], ['Inflatable pad'], ['Frameless pack 40L'], ['Fleece hoodie']],
  },
  {
    name: 'Shoulder-season loop',
    state: 'packed',
    lines: [
      ['Trekking pole tent'], ['20F down quilt'], ['Inflatable pad'], ['Frameless pack 40L'], ['Fleece hoodie'],
      ['Rain jacket'], ['Headlamp'], ['Power bank 10000'], ['Squeeze filter'], ['Trail runners', 1, 'worn'],
    ],
  },
  {
    name: 'Desert section',
    state: 'planning',
    lines: [
      ['Silnylon tarp'], ['20F down quilt'], ['Inflatable pad'], ['Frameless pack 40L'], ['Titanium pot 750'], ['Canister stove'],
      ['Squeeze filter'], ['Smart water bottle 1L', 2], ['Rain jacket'], ['Headlamp'], ['First aid kit'], ['Trowel'],
      ['Trail runners', 1, 'worn'], ['Liner socks', 2, 'worn'], ['Fuel canister 110', 1, 'consumable'], ['Dinner ration', 4, 'consumable'],
    ],
  },
]

async function loadDemo(db: Db): Promise<void> {
  const ids = new Map<string, { id: string; name: string; grams: number }>()
  for (const [name, category, grams, units, price, notes] of GEAR) {
    const id = randomUUID()
    ids.set(name, { id, name, grams })
    await query(
      `INSERT INTO items (id, name, name_key, category, weight_grams, units_owned, price_cents, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, normaliseName(name), category, grams, units, price, notes], db)
  }
  for (const list of LISTS) {
    const listId = randomUUID()
    await query('INSERT INTO lists (id, name, state) VALUES ($1, $2, $3)', [listId, list.name, list.state], db)
    const frozen = list.state !== 'planning'
    for (const [itemName, quantity = 1, mode = 'base'] of list.lines) {
      const item = ids.get(itemName)
      if (!item) throw new Error(`seed names unknown gear ${itemName}`)
      await query(
        `INSERT INTO lines (id, list_id, item_id, quantity, mode, frozen_name, frozen_weight_grams)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), listId, item.id, quantity, mode, frozen ? item.name : null, frozen ? item.grams : null], db)
    }
  }
}

/** Loads the seed when no hiker profile exists; a restart against existing data changes nothing. */
export async function ensureSeed(): Promise<void> {
  const demo = config.seed === 'demo'
  const passphraseHash = await hashPassphrase(SEED_PASSPHRASE)
  await transaction(async (db) => {
    await query('SELECT pg_advisory_xact_lock(4101)', [], db)
    if ((await query('SELECT 1 FROM profile WHERE id = 1', [], db)).length > 0) return
    const [name, zone, paper] = demo ? ['Rowan Tamsin', 'America/Denver', 'Letter'] : ['Hiker', 'UTC', 'A4']
    await query(
      "INSERT INTO profile (id, display_name, unit, goal_grams, time_zone, paper_size, passphrase_hash) VALUES (1, $1, 'g', 4500, $2, $3, $4)",
      [name, zone, paper, passphraseHash], db)
    if (demo) await loadDemo(db)
  })
}
