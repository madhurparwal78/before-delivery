import type { SyncResult } from '../shared/api-types'
import { canonicalJson } from '../shared/numbers'
import { decideOp, parseOp, SYNC_MAX_OPS, SYNC_MIN_OPS } from '../shared/sync-rules'
import { asId, pool, query, transaction, type Db } from './db'
import { declare, required, settle, type Rule } from './fields'
import type { Route } from './http'
import { loadItem } from './closet'
import { deleteLine, insertLine, loadHead, summaries, updateLine } from './lists'
import { loadProfile } from './profile'

const opList: Rule<unknown[]> = (value) =>
  Array.isArray(value) && value.length >= SYNC_MIN_OPS && value.length <= SYNC_MAX_OPS ? { value } : null

const syncFields = declare({ ops: required(opList, 'Send 1 to 200 changes.') })

interface LoggedOp {
  op: unknown
  result: SyncResult['result']
  reason: SyncResult['reason']
}

function opIdOf(raw: unknown): string | null {
  const id = typeof raw === 'object' && raw !== null ? (raw as { opId?: unknown }).opId : undefined
  return typeof id === 'string' ? id : null
}

/** One op, in its own transaction, against current server state. */
async function applyOp(raw: unknown): Promise<SyncResult> {
  const opId = opIdOf(raw)
  const remembered = opId !== null && opId.length >= 1 && opId.length <= 64
  return transaction(async (db) => {
    if (remembered) {
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [opId], db)
      const [logged] = await query<LoggedOp>('SELECT op, result, reason FROM sync_ops WHERE op_id = $1', [opId], db)
      if (logged) {
        return canonicalJson(logged.op) === canonicalJson(raw)
          ? { opId, result: logged.result, reason: logged.reason }
          : { opId, result: 'refused', reason: 'op_id_reused' }
      }
    }
    const outcome = await decideAndApply(db, raw)
    if (remembered) {
      await query('INSERT INTO sync_ops (op_id, op, result, reason) VALUES ($1, $2, $3, $4)', [opId, canonicalJson(raw), outcome.result, outcome.reason], db)
    }
    return { opId, ...outcome }
  })
}

async function decideAndApply(db: Db, raw: unknown): Promise<Omit<SyncResult, 'opId'>> {
  const parsed = parseOp(raw)
  if (!parsed.valid) return { result: 'refused', reason: 'invalid_op' }
  const { op } = parsed
  const head = await loadHead(db, asId(op.listId), true)
  const item = await loadItem(db, asId(op.itemId), 'SHARE')
  const [line] = head && item
    ? await query<{ id: string; quantity: number }>('SELECT id, quantity FROM lines WHERE list_id = $1 AND item_id = $2', [head.id, item.id], db)
    : []
  const decision = decideOp(op, {
    list: head ? { state: head.state } : null,
    item: item ? { unitsOwned: item.units_owned } : null,
    line: line ? { quantity: line.quantity } : null,
  })
  if (decision.result === 'refused') return { result: 'refused', reason: decision.reason }
  const { action } = decision
  if (head && item) {
    if (action.kind === 'insert') await insertLine(db, head.id, item.id, action.quantity, action.mode)
    else if (line && action.kind === 'update') await updateLine(db, line.id, action)
    else if (line) await deleteLine(db, line.id)
  }
  return { result: 'applied', reason: null }
}

const sync: Route = {
  method: 'POST',
  pattern: '/api/sync',
  access: 'session',
  async handler(ctx) {
    const { ops } = settle(syncFields.read(ctx.json()))
    const results: SyncResult[] = []
    for (const raw of ops) results.push(await applyOp(raw))
    const named = new Set<string>()
    for (const raw of ops) {
      const id = asId(typeof raw === 'object' && raw !== null ? (raw as { listId?: unknown }).listId : undefined)
      if (id !== null) named.add(id)
    }
    return { status: 200, body: { results, lists: await summaries(pool, await loadProfile(), [...named]) } }
  },
}

export const syncRoutes: Route[] = [sync]
