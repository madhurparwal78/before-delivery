import { useSyncExternalStore } from 'react'
import type { BlockState, Counters, SessionSnapshot } from '../../shared/domain'
import type { SceneRibbon } from './scene/contract'

// The shell owns every discrete step of the Highball Ribbon: it reveals reservations block by block (180 ms per
// block), so the ribbon, the schematic rows and the reserved counter change in the same step. It only reveals what
// the server committed: the counters are the server's, less the blocks the ribbon has yet to reach or give back.

const STEP_MS = 180

interface Presented {
  ribbons: SceneRibbon[]
  blockStates: Record<number, BlockState>
  counters: Counters | null
  limitFlagBlock: number | null
  conflictBlock: number | null
  animating: boolean
}

const empty: Presented = { ribbons: [], blockStates: {}, counters: null, limitFlagBlock: null, conflictBlock: null, animating: false }

let presented: Presented = empty
const listeners = new Set<() => void>()
let target: SessionSnapshot | null = null
let reduced = false
const shown = new Map<string, number[]>()
interface Refusal { id: string; reachable: number[]; shown: number[]; phase: 'extend' | 'retract' }
const refusals = new Map<string, Refusal>()
let frame = 0
let lastStep = Number.NEGATIVE_INFINITY

export function usePresented(): Presented {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => presented)
}

function numbersOf(snapshot: SessionSnapshot, ids: string[]): number[] {
  return ids.map(id => snapshot.blocks.find(block => block.id === id)?.number).filter((n): n is number => n !== undefined)
}

function targets(): Map<string, number[]> {
  const found = new Map<string, number[]>()
  if (target === null) return found
  for (const authority of target.authorities) {
    if (authority.state === 'Granted') found.set(authority.id, numbersOf(target, authority.remaining_block_ids))
  }
  return found
}

function publish(): void {
  if (target === null) {
    presented = empty
  } else {
    const revealed = new Set([...shown.values()].flat())
    const states: Record<number, BlockState> = {}
    let heldBack = 0
    for (const block of target.blocks) {
      const shownReserved = revealed.has(block.number)
      if (block.state === 'reserved' || block.state === 'free') {
        states[block.number] = shownReserved ? 'reserved' : 'free'
        if (block.state === 'reserved' && !shownReserved) heldBack += 1
        if (block.state === 'free' && shownReserved) heldBack -= 1
      } else {
        states[block.number] = block.state
      }
    }
    const granted = target.authorities.filter(authority => authority.state === 'Granted')
    const flagged = granted[granted.length - 1]
    const flagBlock = flagged === undefined ? null : target.blocks.find(block => block.id === flagged.limit_block_id)?.number ?? null
    const open = [...target.conflicts].reverse().find(conflict => conflict.state === 'Open')
    presented = {
      ribbons: [
        ...[...shown].map(([id, blocks]) => ({ id, blocks })),
        ...[...refusals.values()].map(item => ({ id: `refusal-${item.id}`, blocks: item.shown })),
      ],
      blockStates: states,
      counters: {
        ...target.counters,
        reserved_blocks: target.counters.reserved_blocks - heldBack,
        free_blocks: target.counters.free_blocks + heldBack,
      },
      limitFlagBlock: flagBlock !== null && [...shown.values()].some(blocks => blocks.includes(flagBlock)) ? flagBlock : null,
      conflictBlock: open === undefined ? null : target.blocks.find(block => block.id === open.block_id)?.number ?? null,
      animating: frame !== 0,
    }
  }
  for (const listener of listeners) listener()
}

function stepAuthorities(): boolean {
  let changed = false
  const goal = targets()
  for (const id of new Set([...shown.keys(), ...goal.keys()])) {
    let blocks = shown.get(id) ?? []
    const want = goal.get(id) ?? []
    if (blocks.length > 0 && !want.includes(blocks[0])) {
      blocks = blocks.slice(1)
      changed = true
    }
    if (want.length > 0) {
      const last = blocks.length === 0 ? -1 : want.indexOf(blocks[blocks.length - 1])
      const next = want[last + 1]
      if (next !== undefined && !blocks.includes(next)) {
        blocks = [...blocks, next]
        changed = true
      }
    }
    if (blocks.length === 0) shown.delete(id)
    else shown.set(id, blocks)
  }
  for (const item of refusals.values()) {
    if (item.phase === 'extend') {
      if (item.shown.length < item.reachable.length) item.shown = item.reachable.slice(0, item.shown.length + 1)
      else item.phase = 'retract'
      changed = true
    } else if (item.shown.length > 0) {
      item.shown = item.shown.slice(0, -1)
      changed = true
    } else {
      refusals.delete(item.id)
      changed = true
    }
  }
  return changed
}

function tick(now: number): void {
  frame = 0
  if (now - lastStep >= STEP_MS) {
    lastStep = now
    if (stepAuthorities()) {
      frame = requestAnimationFrame(tick)
      publish()
      return
    }
    lastStep = Number.NEGATIVE_INFINITY
    publish()
    return
  }
  frame = requestAnimationFrame(tick)
}

function settle(): void {
  const goal = targets()
  shown.clear()
  for (const [id, blocks] of goal) shown.set(id, blocks)
  refusals.clear()
}

export function present(snapshot: SessionSnapshot | null, reducedMotion: boolean): void {
  // A session just opened shows its committed state at once: only what happens while it is open plays as motion.
  const opened = snapshot !== null && snapshot.id !== target?.id
  target = snapshot
  reduced = reducedMotion
  if (snapshot === null) {
    shown.clear()
    refusals.clear()
    publish()
    return
  }
  if (reduced || opened) {
    settle()
    publish()
    return
  }
  if (frame === 0) frame = requestAnimationFrame(tick)
  publish()
}

// A refusal extends only to the block before the conflict and retracts at 180 ms per block.
export function playRefusal(authorityId: string, reachable: number[]): void {
  if (reduced || refusals.has(authorityId)) return
  refusals.set(authorityId, { id: authorityId, reachable, shown: [], phase: 'extend' })
  if (frame === 0) frame = requestAnimationFrame(tick)
  publish()
}

export function resetPresenter(): void {
  if (frame !== 0) cancelAnimationFrame(frame)
  frame = 0
  shown.clear()
  refusals.clear()
  target = null
  publish()
}
