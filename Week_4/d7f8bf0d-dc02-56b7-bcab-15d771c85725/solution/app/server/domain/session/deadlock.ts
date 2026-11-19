import type { Deadlock } from '../../../shared/domain'
import { newId } from '../../canonical'
import type { SessionState } from './state'

// The wait-for graph has one edge from each open conflict's train to its other train. A cycle is a deadlock.

function cycles(edges: Map<string, string[]>): string[][] {
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [...(edges.get(from) ?? [])]
    while (stack.length > 0) {
      const next = stack.pop() as string
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(...(edges.get(next) ?? []))
    }
    return seen
  }
  const groups = new Map<string, string[]>()
  for (const node of edges.keys()) {
    if (!reach(node).has(node)) continue
    const members = [...edges.keys()].filter(other => reach(node).has(other) && reach(other).has(node))
    groups.set([...members].sort().join('|'), members)
  }
  return [...groups.values()]
}

export function raiseDeadlocks(state: SessionState, tick: number): Deadlock[] {
  const edges = new Map<string, string[]>()
  for (const conflict of state.conflicts) {
    if (conflict.state !== 'Open' || conflict.other_train_id === null) continue
    edges.set(conflict.train_id, [...(edges.get(conflict.train_id) ?? []), conflict.other_train_id])
  }
  const raised: Deadlock[] = []
  for (const members of cycles(edges)) {
    const numbers = members
      .map(id => state.trains.find(train => train.id === id)?.number ?? id)
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    const known = state.deadlocks.some(deadlock => deadlock.state === 'Open' && deadlock.train_numbers.join(',') === numbers.join(','))
    if (known) continue
    const deadlock: Deadlock = { id: newId('dl'), state: 'Open', raised_at_tick: tick, train_numbers: numbers }
    state.deadlocks.push(deadlock)
    raised.push(deadlock)
  }
  return raised
}

export function openDeadlockOf(state: SessionState, trainNumber: string): Deadlock | undefined {
  return state.deadlocks.find(deadlock => deadlock.state === 'Open' && deadlock.train_numbers.includes(trainNumber))
}

export function clearDeadlocksOf(state: SessionState, trainNumber: string): string[] {
  const cleared: string[] = []
  for (const deadlock of state.deadlocks) {
    if (deadlock.state === 'Open' && deadlock.train_numbers.includes(trainNumber)) {
      deadlock.state = 'Cleared'
      cleared.push(deadlock.id)
    }
  }
  return cleared
}
