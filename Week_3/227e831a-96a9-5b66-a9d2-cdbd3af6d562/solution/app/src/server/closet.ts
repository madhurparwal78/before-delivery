import { randomUUID } from 'node:crypto'
import type { Category, DisplayUnit, Item, Profile } from '../shared/api-types'
import { formatWeight } from '../shared/display'
import { isInCloset } from '../shared/lists'
import { ITEM_EXISTS, itemIdentity, normaliseName } from '../shared/names'
import { canonicalJson } from '../shared/numbers'
import { detectPhotoType, PHOTO_TYPE_MESSAGE } from '../shared/photo-type'
import { asId, pool, query, transaction, uniqueViolation, type Db } from './db'
import { errorBody, refuse, HttpError } from './errors'
import {
  declare, declareHeaders, optional, optionalised, required, rules, settle,
} from './fields'
import type { Route } from './http'
import { loadProfile } from './profile'
import { deleteObject, deletePrefix, getObject, putObject } from './s3'

interface ItemRow {
  id: string
  name: string
  category: Category
  weight_grams: number
  units_owned: number
  price_cents: number | null
  notes: string
  version: number
  photo_id: string | null
}

const ITEM_COLUMNS = 'id, name, category, weight_grams, units_owned, price_cents, notes, version, photo_id'

export async function loadItem(db: Db, id: string | null, lock?: 'UPDATE' | 'SHARE'): Promise<ItemRow | null> {
  if (id === null) return null
  const [row] = await query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1${lock ? ` FOR ${lock}` : ''}`, [id], db)
  return row ?? null
}

/** How many planning or packed lists hold an in-closet line for each item. */
async function packedInCounts(db: Db, itemId?: string): Promise<Map<string, number>> {
  const rows = await query<{ item_id: string; quantity: number; units_owned: number; state: 'planning' | 'packed' }>(
    `SELECT l.item_id, l.quantity, i.units_owned, ls.state
       FROM lines l JOIN lists ls ON ls.id = l.list_id JOIN items i ON i.id = l.item_id
      WHERE ls.state IN ('planning', 'packed')${itemId ? ' AND l.item_id = $1' : ''}`,
    itemId ? [itemId] : [],
    db,
  )
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (isInCloset(row.state, row.quantity, row.units_owned)) counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1)
  }
  return counts
}

function itemJson(row: ItemRow, unit: DisplayUnit, packedInLists: number): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    weightGrams: row.weight_grams,
    weightDisplay: formatWeight(row.weight_grams, unit),
    unitsOwned: row.units_owned,
    status: row.units_owned > 0 ? 'active' : 'retired',
    priceCents: row.price_cents,
    notes: row.notes,
    photo: row.photo_id ? { id: row.photo_id, status: 'ready', url: `/api/photos/${row.photo_id}` } : null,
    packedInLists,
    version: row.version,
  }
}

async function itemReply(db: Db, id: string, profile: Profile): Promise<Item> {
  const row = await loadItem(db, id)
  if (!row) throw refuse.notFound('item')
  return itemJson(row, profile.unit, (await packedInCounts(db, id)).get(id) ?? 0)
}

const closetSpec = {
  name: required(rules.text(1, 80), 'Enter a name.'),
  category: required(rules.category, 'Choose a category.'),
  weight: required(rules.weight(0), 'Enter a weight from 0 to 50000 g.'),
  unitsOwned: required(rules.whole(1, 99), 'Enter whole units from 1 to 99.'),
  priceCents: optional(rules.price, 'Enter a price of 0 or more.'),
  notes: optional(rules.freeText(1000), 'Notes can be at most 1000 characters.'),
}
const createFields = declare(closetSpec)
const editFields = declare(optionalised(closetSpec))
const editHeaders = declareHeaders({
  'If-Match': { whenMissing: () => new HttpError(428, 'precondition_required', 'Send the version you last saw.') },
})

const retireHeaders = declareHeaders({
  'Idempotency-Key': { pattern: /^[A-Za-z0-9_-]{1,64}$/, message: 'Send a key of 1 to 64 letters, digits, - or _.' },
})
const retireFields = declare({
  units: required(rules.units, (context) => `Enter whole units from 1 to ${context.unitsOwned}.`),
  reason: required(rules.retireReason, 'Choose a reason.'),
})

function exists(): HttpError {
  return new HttpError(409, 'item_exists', ITEM_EXISTS)
}

const listItems: Route = {
  method: 'GET',
  pattern: '/api/closet',
  access: 'session',
  async handler() {
    const [profile, rows, counts] = await Promise.all([
      loadProfile(),
      query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY (units_owned = 0), seq`),
      packedInCounts(pool),
    ])
    return { status: 200, body: { items: rows.map((row) => itemJson(row, profile.unit, counts.get(row.id) ?? 0)) } }
  },
}

const createItem: Route = {
  method: 'POST',
  pattern: '/api/closet',
  access: 'session',
  async handler(ctx) {
    const parsed = createFields.read(ctx.json())
    if (parsed.unknown.length > 0) settle(parsed)
    const { name, category } = parsed.values
    return transaction(async (db) => {
      if (name !== undefined && category !== undefined) {
        const taken = await query('SELECT 1 FROM items WHERE category = $1 AND name_key = $2', [category, normaliseName(name)], db)
        if (taken.length > 0) throw exists()
      }
      const values = settle(parsed)
      const id = randomUUID()
      try {
        await query(
          `INSERT INTO items (id, name, name_key, category, weight_grams, units_owned, price_cents, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, values.name, normaliseName(values.name ?? ''), values.category, values.weight, values.unitsOwned, values.priceCents ?? null, values.notes ?? ''],
          db,
        )
      } catch (error) {
        throw uniqueViolation(error) ? exists() : error
      }
      return { status: 201, body: { item: await itemReply(db, id, await loadProfile(db)) } }
    })
  },
}

const editItem: Route = {
  method: 'PATCH',
  pattern: '/api/closet/:id',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    return transaction(async (db) => {
      const item = await loadItem(db, id, 'UPDATE')
      if (!item) throw refuse.notFound('item')
      const sent = editHeaders.read(ctx.header)['If-Match']
      if (sent !== `"${item.version}"`) throw new HttpError(412, 'item_changed', `${item.name} changed on another device.`)
      if (item.units_owned === 0) throw new HttpError(409, 'item_retired', `${item.name} is retired and can't be edited.`)
      const parsed = editFields.read(ctx.json())
      if (parsed.unknown.length > 0) settle(parsed)
      const nextName = parsed.values.name ?? item.name
      const nextCategory = parsed.values.category ?? item.category
      if (itemIdentity(nextName, nextCategory) !== itemIdentity(item.name, item.category)) {
        const taken = await query('SELECT 1 FROM items WHERE category = $1 AND name_key = $2 AND id <> $3', [nextCategory, normaliseName(nextName), item.id], db)
        if (taken.length > 0) throw exists()
      }
      const values = settle(parsed)
      if (values.unitsOwned !== undefined && values.unitsOwned < item.units_owned) {
        throw refuse.validation({ unitsOwned: 'Use retire to reduce units owned.' })
      }
      const next = {
        name: values.name ?? item.name,
        category: values.category ?? item.category,
        weight_grams: values.weight ?? item.weight_grams,
        units_owned: values.unitsOwned ?? item.units_owned,
        price_cents: values.priceCents === undefined ? item.price_cents : values.priceCents,
        notes: values.notes ?? item.notes,
      }
      await query(
        `UPDATE items SET name = $2, name_key = $3, category = $4, weight_grams = $5, units_owned = $6,
                price_cents = $7, notes = $8, version = version + 1 WHERE id = $1`,
        [item.id, next.name, normaliseName(next.name), next.category, next.weight_grams, next.units_owned, next.price_cents, next.notes],
        db,
      )
      return { status: 200, body: { item: await itemReply(db, item.id, await loadProfile(db)) } }
    })
  },
}

const retireItem: Route = {
  method: 'POST',
  pattern: '/api/closet/:id/retire',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    return transaction(async (db) => {
      const exists = id === null ? [] : await query('SELECT 1 FROM items WHERE id = $1', [id], db)
      if (id === null || exists.length === 0) throw refuse.notFound('item')
      const body = ctx.json()
      const key = retireHeaders.read(ctx.header)['Idempotency-Key']
      if (key !== undefined) {
        const [lock] = await query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', [`${id}:${key}`], db)
        if (!lock?.locked) throw new HttpError(409, 'request_in_progress', 'This retirement is still being processed.')
        const [stored] = await query<{ body: unknown; status: number; response: string }>(
          'SELECT body, status, response FROM retire_keys WHERE item_id = $1 AND key = $2', [id, key], db)
        if (stored) {
          if (canonicalJson(stored.body) !== canonicalJson(body)) {
            throw new HttpError(422, 'idempotency_key_reused', 'This key was already used for a different retirement.')
          }
          return { status: stored.status, text: stored.response }
        }
      }
      const outcome = await retire(db, id, body)
      if (key !== undefined) {
        await query('INSERT INTO retire_keys (item_id, key, body, status, response) VALUES ($1, $2, $3, $4, $5)',
          [id, key, canonicalJson(body), outcome.status, JSON.stringify(outcome.body)], db)
      }
      return outcome
    })
  },
}

/** The answer to a retirement; refusals are answers too, so a keyed one can be stored and replayed. */
async function retire(db: Db, id: string, body: Record<string, unknown>) {
  const item = await loadItem(db, id, 'UPDATE')
  if (!item) throw refuse.notFound('item')
  const failure = (error: HttpError) => ({ status: error.status, body: errorBody(error) })
  if (item.units_owned === 0) return failure(new HttpError(409, 'item_retired', `${item.name} is already retired.`))
  const parsed = retireFields.read(body, { unitsOwned: item.units_owned })
  let values
  try {
    values = settle(parsed)
  } catch (error) {
    if (error instanceof HttpError) return failure(error)
    throw error
  }
  await query('UPDATE items SET units_owned = units_owned - $2, version = version + 1 WHERE id = $1', [id, values.units], db)
  const profile = await loadProfile(db)
  const [affected] = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM lines l JOIN lists ls ON ls.id = l.list_id JOIN items i ON i.id = l.item_id
      WHERE ls.state IN ('planning', 'packed') AND l.item_id = $1 AND l.quantity > i.units_owned`, [id], db)
  return { status: 200, body: { item: await itemReply(db, id, profile), affectedLines: affected?.count ?? 0 } }
}

const deleteItem: Route = {
  method: 'DELETE',
  pattern: '/api/closet/:id',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    return transaction(async (db) => {
      const item = await loadItem(db, id, 'UPDATE')
      if (!item) throw refuse.notFound('item')
      const used = await query('SELECT 1 FROM lines WHERE item_id = $1 LIMIT 1', [item.id], db)
      if (used.length > 0) throw new HttpError(409, 'item_in_lists', `${item.name} is on a trip list and can't be deleted. Retire it instead.`)
      if (item.photo_id) await deletePrefix(`photos/${item.id}/`)
      await query('DELETE FROM items WHERE id = $1', [item.id], db)
      return { status: 204 }
    })
  },
}

const MAX_PHOTO_BYTES = 5000000

const addPhoto: Route = {
  method: 'POST',
  pattern: '/api/closet/:id/photo',
  access: 'session',
  body: { kind: 'multipart', fileLimit: MAX_PHOTO_BYTES },
  async handler(ctx) {
    const item = await loadItem(pool, asId(ctx.params.id))
    if (!item) throw refuse.notFound('item')
    if (item.units_owned === 0) throw new HttpError(409, 'item_retired', `${item.name} is retired.`)
    const part = ctx.file('photo')
    if (part && part.data.length > MAX_PHOTO_BYTES) throw refuse.payloadTooLarge()
    const type = part ? detectPhotoType(part.data) : null
    if (!part || !type) throw refuse.validation({ photo: PHOTO_TYPE_MESSAGE })
    const photoId = randomUUID()
    await putObject(`photos/${item.id}/${photoId}.${type.extension}`, part.data, type.contentType)
    const previous = await transaction(async (db) => {
      const locked = await loadItem(db, item.id, 'UPDATE')
      if (!locked) throw refuse.notFound('item')
      await query('INSERT INTO photos (id, item_id, extension, content_type) VALUES ($1, $2, $3, $4)', [photoId, item.id, type.extension, type.contentType], db)
      await query('UPDATE items SET photo_id = $2, version = version + 1 WHERE id = $1', [item.id, photoId], db)
      if (!locked.photo_id) return null
      const [old] = await query<{ extension: string }>('DELETE FROM photos WHERE id = $1 RETURNING extension', [locked.photo_id], db)
      return old ? `photos/${item.id}/${locked.photo_id}.${old.extension}` : null
    })
    // The new photo is already confirmed; a leftover earlier object is only unreferenced storage.
    if (previous) await deleteObject(previous).catch(() => undefined)
    return { status: 201, body: { photo: { id: photoId, status: 'ready', url: `/api/photos/${photoId}` } } }
  },
}

const servePhoto: Route = {
  method: 'GET',
  pattern: '/api/photos/:id',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    const [photo] = id ? await query<{ item_id: string; extension: string; content_type: string }>('SELECT item_id, extension, content_type FROM photos WHERE id = $1', [id]) : []
    if (!photo) throw refuse.notFound('photo')
    const data = await getObject(`photos/${photo.item_id}/${id}.${photo.extension}`)
    if (!data) throw refuse.notFound('photo')
    return { status: 200, bytes: { data, contentType: photo.content_type }, headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' } }
  },
}

export const closetRoutes: Route[] = [listItems, createItem, editItem, retireItem, deleteItem, addPhoto, servePhoto]
