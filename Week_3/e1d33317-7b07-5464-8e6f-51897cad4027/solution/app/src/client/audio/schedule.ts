// Turns a staff's placed events into notes on the score's time line.

import { pitchMidi } from '../../shared/music.js'
import type { Dynamic, PlacedEvent } from '../../shared/voice.js'
import type { Timeline } from './timeline.js'

export interface ScheduledNote {
  /** Seconds from the start of the score. */
  at: number
  length: number
  midi: number
  level: number
}

const DEFAULT_LEVEL = 0.85
const DYNAMIC_LEVEL: Record<Dynamic, number> = { pp: 0.45, p: 0.6, mp: 0.75, mf: 0.9, f: 1.05, ff: 1.2, sfz: 1.2, fp: 1.05 }
const DYNAMIC_HELD: Partial<Record<Dynamic, Dynamic>> = { sfz: 'f', fp: 'p' }

/**
 * Notes that start at or after `fromTick`, in time order, both voices together. A tied note sounds once
 * for the ticks of the whole tie; a dynamic holds until the next one; rests are silent.
 */
export function compileNotes(voices: readonly (readonly PlacedEvent[])[], timeline: Timeline, fromTick: number): ScheduledNote[] {
  const notes: ScheduledNote[] = []
  const endSeconds = timeline.endSeconds
  for (const events of voices) {
    let tick = 0
    let level = DEFAULT_LEVEL
    for (let i = 0; i < events.length; i++) {
      const event = events[i] as PlacedEvent
      const start = tick
      let ticks = event.ticks
      if (event.kind === 'note' && event.pitch) {
        const midi = pitchMidi(event.pitch)
        let last = event
        while (last.tie) {
          const next = events[i + 1]
          if (!next || next.kind !== 'note' || !next.pitch || pitchMidi(next.pitch) !== midi) break
          ticks += next.ticks
          last = next
          i++
        }
        const noteLevel = event.dynamic ? DYNAMIC_LEVEL[event.dynamic] : level
        if (event.dynamic) level = DYNAMIC_LEVEL[DYNAMIC_HELD[event.dynamic] ?? event.dynamic]
        const at = timeline.secondsAtTick(start)
        if (start >= fromTick && at < endSeconds) {
          notes.push({ at, length: timeline.secondsAtTick(start + ticks) - at, midi, level: noteLevel })
        }
      }
      tick += ticks
    }
  }
  return notes.sort((a, b) => a.at - b.at)
}
