import type { GameStatus, TimerSegment, TimerState } from '../shared/types.ts'

export interface Segment {
  startedAt: Date
  endedAt: Date | null
}

/** The one timer arithmetic: the sum of closed segments plus the time since the open one started. */
export function elapsedMs(segments: readonly Segment[], now: number): number {
  return segments.reduce((total, segment) => total + (segment.endedAt ?? new Date(now)).getTime() - segment.startedAt.getTime(), 0)
}

export const timerState = (status: GameStatus): TimerState => (status === 'live' ? 'running' : status === 'solved' ? 'solved' : 'paused')

export const segmentJson = (segment: Segment): TimerSegment => ({ started_at: segment.startedAt.toISOString(), ended_at: segment.endedAt?.toISOString() ?? null })
