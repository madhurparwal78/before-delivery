import { randomUUID } from 'node:crypto'
import type { CarryMode, ListState, Profile, TripList } from '../shared/api-types'
import { buildList, isInCloset, type LineSource } from '../shared/lists'
import { canMove, illegalTransitionMessage, notEditableMessage } from '../shared/list-state'
import { asId, pool, query, transaction, type Db } from './db'
import { HttpError, refuse } from './errors'
import { declare, optional, rules, required, settle } from './fields'
import type { Route } from './http'
import { loadItem } from './closet'
import { loadProfile } from './profile'

interface ListRow {
  id: string
  name: string
  state: ListState
}

interface LineRow {
  id: string
  list_id: string
  item_id: string
  quantity: number
  mode: CarryMode
  frozen_name: string | null
  frozen_weight_grams: number | null
  name: string
  category: LineSource['item']['category']
  weight_grams: number
  units_owned: number
}

const LINE_SELECT = `SELECT l.id, l.list_id, l.item_id, l.quantity, l.mode, l.frozen_name, l.frozen_weight_grams,
       i.name, i.category, i.weight_grams, i.units_owned
  FROM lines l JOIN items i ON i.id = l.item_id`

function toSource(row: LineRow): LineSource {
  return {
    id: row.id,
    itemId: row.item_id,
    quantity: row.quantity,
    mode: row.mode,
    frozenName: row.frozen_name,
    frozenWeightGrams: row.frozen_weight_grams,
    item: { name: row.name, category: row.category, weightGrams: row.weight_grams, unitsOwned: row.units_owned },
  }
}

export async function loadHead(db: Db, id: string | null, lock = false): Promise<ListRow | null> {
  if (id === null) return null
  const [row] = await query<ListRow>(`SELECT id, name, state FROM lists WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id], db)
  return row ?? null
}

export async function loadList(db: Db, head: ListRow, profile: Profile): Promise<TripList> {
  const rows = await query<LineRow>(`${LINE_SELECT} WHERE l.list_id = $1 ORDER BY l.position`, [head.id], db)
  return buildList(head, rows.map(toSource), profile)
}

async function loadAll(db: Db, profile: Profile, ids?: string[]): Promise<TripList[]> {
  const heads = await query<ListRow>(
    `SELECT id, name, state FROM lists${ids ? ' WHERE id = ANY($1)' : ''} ORDER BY seq DESC`, ids ? [ids] : [], db)
  const lines = await query<LineRow>(`${LINE_SELECT}${ids ? ' WHERE l.list_id = ANY($1)' : ''} ORDER BY l.position`, ids ? [ids] : [], db)
  return heads.map((head) => buildList(head, lines.filter((row) => row.list_id === head.id).map(toSource), profile))
}

export async function summaries(db: Db, profile: Profile, ids?: string[]) {
  return (await loadAll(db, profile, ids)).map(({ id, name, state, totals }) => ({ id, name, state, totals }))
}

const listFields = declare({ name: required(rules.text(1, 80), 'Enter a list name of up to 80 characters.') })
const lineCreateFields = declare({
  itemId: required(rules.string, 'Choose an item.'),
  quantity: optional(rules.quantity, 'Quantity must be at least 1.'),
  mode: optional(rules.mode, 'Choose base, worn or consumable.'),
})
const lineEditFields = declare({
  quantity: optional(rules.quantity, 'Quantity must be at least 1.'),
  mode: optional(rules.mode, 'Choose base, worn or consumable.'),
})
const stateFields = declare({ to: required(rules.listState, 'Choose planning, packed or walked.') })

function notEditable(head: ListRow): HttpError {
  return new HttpError(409, 'list_not_editable', notEditableMessage(head.name, head.state))
}

async function requireList(db: Db, id: string | undefined, lock = true): Promise<ListRow> {
  const head = await loadHead(db, asId(id), lock)
  if (!head) throw refuse.notFound('list')
  return head
}

/** Writes to one line, in the order the rules published for every route and for sync. */
export async function insertLine(db: Db, listId: string, itemId: string, quantity: number, mode: CarryMode): Promise<void> {
  await query('INSERT INTO lines (id, list_id, item_id, quantity, mode) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), listId, itemId, quantity, mode], db)
}

export async function updateLine(db: Db, lineId: string, change: { quantity?: number; mode?: CarryMode }): Promise<void> {
  await query('UPDATE lines SET quantity = COALESCE($2, quantity), mode = COALESCE($3, mode) WHERE id = $1', [lineId, change.quantity ?? null, change.mode ?? null], db)
}

export async function deleteLine(db: Db, lineId: string): Promise<void> {
  await query('DELETE FROM lines WHERE id = $1', [lineId], db)
}

async function listReply(db: Db, head: ListRow, status = 200) {
  return { status, body: { list: await loadList(db, head, await loadProfile(db)) } }
}

const getLists: Route = {
  method: 'GET',
  pattern: '/api/lists',
  access: 'session',
  async handler() {
    return { status: 200, body: { lists: await summaries(pool, await loadProfile()) } }
  },
}

const createList: Route = {
  method: 'POST',
  pattern: '/api/lists',
  access: 'session',
  async handler(ctx) {
    const values = settle(listFields.read(ctx.json()))
    const id = randomUUID()
    await query("INSERT INTO lists (id, name, state) VALUES ($1, $2, 'planning')", [id, values.name])
    return listReply(pool, { id, name: values.name ?? '', state: 'planning' }, 201)
  },
}

const getList: Route = {
  method: 'GET',
  pattern: '/api/lists/:id',
  access: 'session',
  async handler(ctx) {
    return listReply(pool, await requireList(pool, ctx.params.id, false))
  },
}

const renameList: Route = {
  method: 'PATCH',
  pattern: '/api/lists/:id',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id)
      if (head.state === 'walked') throw notEditable(head)
      const values = settle(listFields.read(ctx.json()))
      await query('UPDATE lists SET name = $2 WHERE id = $1', [head.id, values.name], db)
      return listReply(db, { ...head, name: values.name ?? head.name })
    })
  },
}

function ownedMessage(unitsOwned: number): { quantity: string } {
  return { quantity: `You own ${unitsOwned}.` }
}

const addLine: Route = {
  method: 'POST',
  pattern: '/api/lists/:id/lines',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id)
      const parsed = lineCreateFields.read(ctx.json())
      const item = await loadItem(db, asId(parsed.values.itemId), 'SHARE')
      if (parsed.values.itemId !== undefined && !item) throw refuse.notFound('item')
      if (head.state !== 'planning') throw notEditable(head)
      if (item) {
        if (item.units_owned === 0) throw new HttpError(409, 'item_retired', `${item.name} is no longer in your closet.`)
        const existing = await query('SELECT 1 FROM lines WHERE list_id = $1 AND item_id = $2', [head.id, item.id], db)
        if (existing.length > 0) throw new HttpError(409, 'line_exists', `${item.name} is already on this list.`)
      }
      const values = settle(parsed)
      if (!item) throw refuse.notFound('item')
      const quantity = values.quantity ?? 1
      if (quantity > item.units_owned) throw refuse.validation(ownedMessage(item.units_owned))
      await insertLine(db, head.id, item.id, quantity, values.mode ?? 'base')
      return listReply(db, head, 201)
    })
  },
}

async function requireLine(db: Db, head: ListRow, lineId: string | undefined) {
  const id = asId(lineId)
  const [line] = id ? await query<{ id: string; item_id: string; quantity: number }>('SELECT id, item_id, quantity FROM lines WHERE id = $1 AND list_id = $2', [id, head.id], db) : []
  if (!line) throw refuse.notFound('line')
  if (head.state !== 'planning') throw notEditable(head)
  return line
}

const editLine: Route = {
  method: 'PATCH',
  pattern: '/api/lists/:id/lines/:lineId',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id)
      const line = await requireLine(db, head, ctx.params.lineId)
      const values = settle(lineEditFields.read(ctx.json()))
      const item = await loadItem(db, line.item_id, 'SHARE')
      const owned = item?.units_owned ?? 0
      if (values.quantity !== undefined && values.quantity > owned) throw refuse.validation(ownedMessage(owned))
      await updateLine(db, line.id, values)
      return listReply(db, head)
    })
  },
}

const removeLine: Route = {
  method: 'DELETE',
  pattern: '/api/lists/:id/lines/:lineId',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id)
      const line = await requireLine(db, head, ctx.params.lineId)
      await deleteLine(db, line.id)
      return listReply(db, head)
    })
  },
}

const changeState: Route = {
  method: 'POST',
  pattern: '/api/lists/:id/state',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id)
      const { to } = settle(stateFields.read(ctx.json()))
      if (!canMove(head.state, to)) throw new HttpError(409, 'illegal_transition', illegalTransitionMessage(head.state, to))
      if (to === 'packed') {
        const lines = await query<LineRow>(`${LINE_SELECT} WHERE l.list_id = $1`, [head.id], db)
        if (lines.some((row) => !isInCloset(head.state, row.quantity, row.units_owned))) {
          throw new HttpError(409, 'lines_not_in_closet', 'Some lines are not in your closet. Unpack them before marking this list packed.')
        }
        if (lines.length === 0) throw new HttpError(409, 'empty_list', 'Add at least one item before marking this list packed.')
        await query('UPDATE lines l SET frozen_name = i.name, frozen_weight_grams = i.weight_grams FROM items i WHERE i.id = l.item_id AND l.list_id = $1', [head.id], db)
      }
      if (to === 'planning') await query('UPDATE lines SET frozen_name = NULL, frozen_weight_grams = NULL WHERE list_id = $1', [head.id], db)
      await query('UPDATE lists SET state = $2 WHERE id = $1', [head.id, to], db)
      return listReply(db, { ...head, state: to })
    })
  },
}

export const listRoutes: Route[] = [getLists, createList, getList, renameList, addLine, editLine, removeLine, changeState]
