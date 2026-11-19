import { useSyncExternalStore } from 'react'
import type { RoutePreview } from '../../shared/domain'
import { ApiFailure, apiGet, apiPlain } from './api'
import { store } from './state'

// Route panel inputs. Only the answer to the newest input may change the preview or the block results; earlier
// answers are discarded whenever they arrive, and the final keystroke is always searched.

const QUIET_MS = 200

interface BlockResult { id: string; number: number; name: string }

interface RouteState {
  destination: string
  via: string
  limitMinutes: number
  previewLine: string
  previewBlocks: number[]
  previewError: string
  search: string
  results: BlockResult[]
}

const initial: RouteState = { destination: '', via: '', limitMinutes: 60, previewLine: '', previewBlocks: [], previewError: '', search: '', results: [] }
let state = initial
const listeners = new Set<() => void>()
let previewTimer = 0
let previewSeq = 0
let searchTimer = 0
let searchSeq = 0

function set(change: Partial<RouteState>): void {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
}

export const useRoute = (): RouteState => useSyncExternalStore(listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}, () => state)

export const routeNow = (): RouteState => state

export function resetRoute(): void {
  clearTimeout(previewTimer)
  clearTimeout(searchTimer)
  previewSeq += 1
  searchSeq += 1
  set(initial)
}

function clearPreview(): void {
  set({ previewLine: '', previewBlocks: [], previewError: '' })
}

// When the selected train's authority ends, the route it ran is finished: the panel goes back to asking for a destination.
let road: { train: string | null; authority: string | null } = { train: null, authority: null }
store.subscribe(() => {
  const { session, selection } = store.get()
  const train = selection.trainNumber
  const authority = session?.trains.find(candidate => candidate.number === train)?.authority_id ?? null
  if (road.train === train && road.authority !== null && authority === null) {
    clearTimeout(previewTimer)
    previewSeq += 1
    set({ destination: '', via: '', previewLine: '', previewBlocks: [], previewError: '' })
  }
  road = { train, authority }
})

function sessionPath(): string {
  const { workspaceId, sessionId } = store.get()
  return `/api/workspaces/${workspaceId}/sessions/${sessionId}`
}

export function requestPreview(): void {
  clearTimeout(previewTimer)
  const seq = ++previewSeq
  const { session, selection } = store.get()
  const train = session?.trains.find(candidate => candidate.number === selection.trainNumber)
  if (session === null || train === undefined || state.destination === '') {
    clearPreview()
    return
  }
  const body = { destination_block_id: state.destination, via_block_id: state.via === '' ? null : state.via }
  previewTimer = window.setTimeout(() => {
    void apiPlain<RoutePreview>('POST', `${sessionPath()}/trains/${train.id}/route-preview`, body).then(
      answer => {
        if (seq !== previewSeq) return
        const snapshot = store.get().session
        const numberOf = (id: string): number => snapshot?.blocks.find(block => block.id === id)?.number ?? 0
        const numbers = answer.route_block_ids.map(numberOf)
        const blockedAt = answer.conflict_block_id === null ? null : snapshot?.blocks.find(block => block.id === answer.conflict_block_id)
        const line = blockedAt === null || blockedAt === undefined
          ? `Route: ${numbers.join(', ')}`
          : answer.other_train_number === null
            ? `Blocked at Block ${blockedAt.number}, out of service`
            : `Blocked at Block ${blockedAt.number} by Train ${answer.other_train_number}`
        set({ previewLine: line, previewBlocks: numbers, previewError: '' })
      },
      (error: unknown) => {
        if (seq !== previewSeq) return
        set({ previewLine: '', previewBlocks: [], previewError: error instanceof ApiFailure ? error.message : 'No route.' })
      },
    )
  }, QUIET_MS)
}

export function setDestination(id: string): void {
  set({ destination: id })
  requestPreview()
}

export function setVia(id: string): void {
  set({ via: id })
  requestPreview()
}

export function setLimitMinutes(minutes: number): void {
  set({ limitMinutes: minutes })
}

export function setSearch(text: string): void {
  clearTimeout(searchTimer)
  const seq = ++searchSeq
  set({ search: text })
  if (text.trim() === '') {
    set({ results: [] })
    return
  }
  searchTimer = window.setTimeout(() => {
    void apiGet<{ blocks: BlockResult[] }>(`${sessionPath()}/blocks?q=${encodeURIComponent(text)}`).then(
      answer => {
        if (seq === searchSeq) set({ results: answer.blocks })
      },
      () => undefined,
    )
  }, QUIET_MS)
}
