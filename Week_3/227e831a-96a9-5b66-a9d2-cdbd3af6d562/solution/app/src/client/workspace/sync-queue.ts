import type { Item, ListSummary, SyncOp } from '../../shared/api-types'
import { refusalSentence, syncSummary } from '../../shared/sync-rules'
import { api, ApiError, NetworkError } from '../api'
import { cache, type QueuedOp } from '../cache'
import { holdForSignIn } from '../session-hold'
import { online, Store } from '../status'
import type { Desired } from './display'

/** The summary the Sync results region shows, and a nudge to move focus to the heading after a resumed sync. */
export const syncState = new Store<{ summary: string; headingFocus: number; syncedAt: number }>({ summary: '', headingFocus: 0, syncedAt: 0 })

let running = false

export function enqueue(entry: QueuedOp): void {
  cache.queue.set([...cache.queue.get(), entry])
}

/** The targets a list's queued ops lead to, replayed over what the device last saw from the server. */
export function replayQueue(
  listId: string,
  confirmed: ReadonlyMap<string, { quantity: number; mode: Desired['mode'] }>,
): Map<string, Desired> {
  const targets = new Map<string, Desired>()
  for (const { op } of cache.queue.get()) {
    if (op.listId !== listId) continue
    const known = confirmed.get(op.itemId)
    const current: Desired = targets.get(op.itemId) ?? (known ? { exists: true, ...known } : { exists: false, quantity: 1, mode: 'base' })
    if (op.type === 'pack') targets.set(op.itemId, { exists: true, quantity: op.quantity ?? 1, mode: op.mode ?? 'base' })
    else if (op.type === 'unpack') targets.set(op.itemId, { ...current, exists: false })
    else if (op.type === 'set_quantity') targets.set(op.itemId, { ...current, quantity: op.quantity ?? current.quantity })
    else targets.set(op.itemId, { ...current, mode: op.mode ?? current.mode })
  }
  return targets
}

export function newOp(listId: string, itemId: string, change: Omit<SyncOp, 'opId' | 'listId' | 'itemId'>): SyncOp {
  return { opId: crypto.randomUUID(), listId, itemId, ...change }
}

const listeners = new Set<() => void>()

/** Told when a queued sync has finished, so open workspaces show the server's state. */
export function onSynced(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function sentences(sent: QueuedOp[], results: Awaited<ReturnType<typeof api.sync>>['results'], items: Item[], lists: ListSummary[]): string[] {
  return results.flatMap((result, index) => {
    const queued = sent[index]
    if (result.result !== 'refused' || !queued) return []
    const item = items.find((candidate) => candidate.id === queued.op.itemId)
    const list = lists.find((candidate) => candidate.id === queued.op.listId)
    return [refusalSentence(result.reason, {
      itemName: item?.name ?? null, listName: list?.name ?? null, listState: list?.state ?? null, unitsOwned: item?.unitsOwned ?? null,
    })]
  })
}

/** Replays the queue through POST /api/sync in order; the answer replaces the device's guesses. */
export async function flushQueue(afterSignIn = false): Promise<void> {
  const pending = cache.queue.get()
  if (running || pending.length === 0 || !online.get()) return
  running = true
  let completed = false
  try {
    const sent = pending.slice(0, 200)
    const { results, lists } = await api.sync(sent.map((entry) => entry.op))
    cache.queue.set(cache.queue.get().slice(sent.length))
    const items = await api.closet().catch(() => cache.closet.get() ?? [])
    cache.closet.set(items)
    const applied = results.filter((result) => result.result === 'applied').length
    syncState.set({
      summary: syncSummary(applied, sent.length, sentences(sent, results, items, lists)),
      headingFocus: afterSignIn ? syncState.get().headingFocus + 1 : syncState.get().headingFocus,
      syncedAt: syncState.get().syncedAt + 1,
    })
    completed = true
    for (const listener of listeners) listener()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      holdForSignIn({
        resume: () => flushQueue(true),
        cancel: () => syncState.set({ ...syncState.get(), headingFocus: syncState.get().headingFocus + 1 }),
      })
    } else if (!(error instanceof NetworkError)) throw error
  } finally {
    running = false
  }
  if (completed && cache.queue.get().length > 0) await flushQueue(afterSignIn)
}
