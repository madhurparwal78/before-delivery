// The tempo map: converts between ticks, audio-time seconds from the start of the score and
// measure/beat positions. Each measure plays at the tempo in force at its first beat.

import { MeasureGrid, WHOLE_TICKS } from '../../shared/music.js'
import type { PlaybackScore } from './types.js'

const TICKS_PER_QUARTER = WHOLE_TICKS / 4
const DEFAULT_BPM = 120

export interface ScorePosition {
  measure: number
  beat: number
}

export class Timeline {
  readonly measureCount: number
  private readonly grid: MeasureGrid
  private readonly tempos: { measure: number; bpm: number }[]
  /** `starts[m - 1]` is the time in seconds at which measure m begins. */
  private readonly starts: number[] = [0]

  constructor(score: PlaybackScore) {
    this.measureCount = Math.max(1, score.measureCount)
    this.grid = new MeasureGrid(score.timeSignatures.length ? score.timeSignatures : [{ measure: 1, beats: 4, beatType: 4 }])
    this.tempos = [...score.tempos].filter((t) => t.bpm > 0).sort((a, b) => a.measure - b.measure)
  }

  private bpmAt(measure: number): number {
    let bpm = this.tempos[0]?.bpm ?? DEFAULT_BPM
    for (const tempo of this.tempos) if (tempo.measure <= measure) bpm = tempo.bpm
    return bpm
  }

  private secondsPerTick(measure: number): number {
    return 60 / (TICKS_PER_QUARTER * this.bpmAt(measure))
  }

  private measureLengthSeconds(measure: number): number {
    return this.grid.measureLength(measure) * this.secondsPerTick(measure)
  }

  startOfMeasure(measure: number): number {
    while (this.starts.length < measure) {
      const m = this.starts.length
      this.starts.push((this.starts[m - 1] as number) + this.measureLengthSeconds(m))
    }
    return this.starts[measure - 1] as number
  }

  get endSeconds(): number {
    return this.startOfMeasure(this.measureCount + 1)
  }

  secondsAtTick(tick: number): number {
    const measure = this.grid.measureAt(tick)
    return this.startOfMeasure(measure) + (tick - this.grid.measureStart(measure)) * this.secondsPerTick(measure)
  }

  tickAtMeasure(measure: number): number {
    return this.grid.measureStart(measure)
  }

  /** The measure and beat sounding at `seconds`; the beat is rounded down to three decimals. */
  positionAt(seconds: number): ScorePosition {
    const clamped = Math.min(Math.max(seconds, 0), this.endSeconds)
    let low = 1
    let high = this.measureCount
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (this.startOfMeasure(mid) <= clamped) low = mid
      else high = mid - 1
    }
    const signature = this.grid.signatureAt(low)
    const ticksIn = (clamped - this.startOfMeasure(low)) / this.secondsPerTick(low)
    const beat = 1 + ticksIn / (WHOLE_TICKS / signature.beatType)
    const lastBeat = signature.beats + 0.999
    return { measure: low, beat: Math.min(lastBeat, Math.floor(beat * 1000 + 1e-6) / 1000) }
  }
}
