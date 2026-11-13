// Notation arithmetic shared by the server and the editor: pitches, durations, ticks,
// time signatures and the barline split. Each rule is decided here once.

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
export type Clef = 'treble' | 'alto' | 'tenor' | 'bass' | 'percussion'
export type DurationName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd'

export interface Pitch {
  step: Step
  alter: number
  octave: number
}

export interface Transpose {
  diatonic: number
  chromatic: number
}

export interface TimeSignature {
  measure: number
  beats: number
  beatType: number
}

export interface Piece {
  measure: number
  beat: number
  ticks: number
}

export const WHOLE_TICKS = 1920
export const DURATIONS: readonly DurationName[] = ['32nd', '16th', 'eighth', 'quarter', 'half', 'whole']
export const CLEFS: readonly Clef[] = ['treble', 'alto', 'tenor', 'bass', 'percussion']
const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

const DURATION_TICKS: Record<DurationName, number> = { whole: 1920, half: 960, quarter: 480, eighth: 240, '16th': 120, '32nd': 60 }
const DURATION_WORD: Record<DurationName, string> = {
  whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', '16th': 'sixteenth', '32nd': 'thirty-second',
}
const PITCH_CLASS: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const ACCIDENTAL_SIGN: Record<number, string> = { 0: '', 1: '♯', [-1]: '♭', 2: '𝄪', [-2]: '𝄫' }
const MIDDLE_LINE: Record<Clef, { step: Step; octave: number }> = {
  treble: { step: 'B', octave: 4 },
  percussion: { step: 'B', octave: 4 },
  alto: { step: 'C', octave: 4 },
  tenor: { step: 'A', octave: 3 },
  bass: { step: 'D', octave: 3 },
}

export function isDuration(value: unknown): value is DurationName {
  return typeof value === 'string' && value in DURATION_TICKS
}

export function isPitch(value: unknown): value is Pitch {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return typeof p.step === 'string' && p.step in PITCH_CLASS && Number.isInteger(p.alter) && (p.alter as number) >= -2 &&
    (p.alter as number) <= 2 && Number.isInteger(p.octave) && (p.octave as number) >= 0 && (p.octave as number) <= 9
}

export function durationTicks(duration: DurationName, dots: number): number {
  const base = DURATION_TICKS[duration]
  return base + (dots >= 1 ? base / 2 : 0) + (dots >= 2 ? base / 4 : 0)
}

export function durationWord(duration: DurationName, dots: number): string {
  return `${dots === 1 ? 'dotted ' : dots === 2 ? 'double-dotted ' : ''}${DURATION_WORD[duration]}`
}

export function plainDurationWord(duration: DurationName): string {
  return DURATION_WORD[duration]
}

export function pitchText(p: Pitch): string {
  return `${p.step}${ACCIDENTAL_SIGN[p.alter]} ${p.octave}`
}

export function pitchMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + PITCH_CLASS[p.step] + p.alter
}

export function staffStep(step: Step, octave: number): number {
  return octave * 7 + STEPS.indexOf(step)
}

export function formatBeat(beat: number): string {
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function middleLine(clef: Clef): { step: Step; octave: number } {
  return MIDDLE_LINE[clef]
}

/** Octave that puts `step` nearest, in staff steps, to the reference note. */
export function nearestOctave(step: Step, reference: { step: Step; octave: number }): number {
  const target = staffStep(reference.step, reference.octave)
  let best = reference.octave
  for (const octave of [reference.octave - 1, reference.octave, reference.octave + 1]) {
    if (Math.abs(staffStep(step, octave) - target) < Math.abs(staffStep(step, best) - target)) best = octave
  }
  return best
}

/** One semitone, spelled natural where possible, otherwise sharp going up and flat going down. */
export function moveSemitone(p: Pitch, up: boolean): Pitch {
  const midi = pitchMidi(p) + (up ? 1 : -1)
  const octave = Math.floor(midi / 12) - 1
  const pc = ((midi % 12) + 12) % 12
  const natural = STEPS.find((s) => PITCH_CLASS[s] === pc)
  if (natural) return { step: natural, alter: 0, octave }
  const source = STEPS.find((s) => PITCH_CLASS[s] === (up ? pc - 1 : pc + 1))
  return { step: source ?? 'C', alter: up ? 1 : -1, octave }
}

export function moveOctave(p: Pitch, up: boolean): Pitch {
  return { ...p, octave: Math.min(9, Math.max(0, p.octave + (up ? 1 : -1))) }
}

/** The next spelling of the same sounding pitch, lowest letter-and-octave first, wrapping. */
export function respell(p: Pitch): Pitch {
  const midi = pitchMidi(p)
  const candidates: Pitch[] = []
  for (let octave = p.octave - 1; octave <= p.octave + 1; octave++) {
    for (const step of STEPS) {
      const alter = midi - ((octave + 1) * 12 + PITCH_CLASS[step])
      if (alter >= -2 && alter <= 2) candidates.push({ step, alter, octave })
    }
  }
  candidates.sort((a, b) => staffStep(a.step, a.octave) - staffStep(b.step, b.octave))
  const at = candidates.findIndex((c) => c.step === p.step && c.alter === p.alter && c.octave === p.octave)
  return candidates[(at + 1) % candidates.length] as Pitch
}

export function transposePitch(p: Pitch, transpose: Transpose, sign: 1 | -1): Pitch {
  const diatonic = staffStep(p.step, p.octave) + sign * transpose.diatonic
  const octave = Math.floor(diatonic / 7)
  const step = STEPS[((diatonic % 7) + 7) % 7] as Step
  const target = pitchMidi(p) + sign * transpose.chromatic
  const alter = target - ((octave + 1) * 12 + PITCH_CLASS[step])
  return { step, alter: Math.max(-2, Math.min(2, alter)), octave }
}

/** Parses "A4", "C#5", "Bb3". */
export function parseRoot(text: string): Pitch | null {
  const m = /^([A-G])([#b]?)(\d)$/.exec(text)
  if (!m) return null
  return { step: m[1] as Step, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) }
}

function measureTicks(sig: { beats: number; beatType: number }): number {
  return sig.beats * (WHOLE_TICKS / sig.beatType)
}

/** Maps tick positions to measures under the time signature list; the last signature repeats forever. */
export class MeasureGrid {
  private readonly starts: { measure: number; tick: number; beats: number; beatType: number }[] = []

  constructor(signatures: readonly TimeSignature[]) {
    const sorted = [...signatures].sort((a, b) => a.measure - b.measure)
    let tick = 0
    let previous: TimeSignature | null = null
    for (const sig of sorted) {
      if (previous) tick += (sig.measure - previous.measure) * measureTicks(previous)
      this.starts.push({ measure: sig.measure, tick, beats: sig.beats, beatType: sig.beatType })
      previous = sig
    }
  }

  signatureAt(measure: number): { beats: number; beatType: number } {
    let found = this.starts[0] as { beats: number; beatType: number; measure: number }
    for (const s of this.starts) if (s.measure <= measure) found = s
    return found
  }

  measureLength(measure: number): number {
    return measureTicks(this.signatureAt(measure))
  }

  measureStart(measure: number): number {
    let seg = this.starts[0] as (typeof this.starts)[number]
    for (const s of this.starts) if (s.measure <= measure) seg = s
    return seg.tick + (measure - seg.measure) * measureTicks(seg)
  }

  /** The measure holding tick `at` (a tick exactly on a barline belongs to the measure that starts there). */
  measureAt(at: number): number {
    let seg = this.starts[0] as (typeof this.starts)[number]
    for (const s of this.starts) if (s.tick <= at) seg = s
    return seg.measure + Math.floor((at - seg.tick) / measureTicks(seg))
  }

  /** Number of measures needed to hold music ending at tick `end`. */
  measuresFor(end: number): number {
    return end <= 0 ? 0 : this.measureAt(end - 1)
  }

  /** Splits [start, start+length) at every barline it crosses. */
  pieces(start: number, length: number): Piece[] {
    const out: Piece[] = []
    let pos = start
    const end = start + length
    while (pos < end) {
      const measure = this.measureAt(pos)
      const from = this.measureStart(measure)
      const take = Math.min(end, from + this.measureLength(measure)) - pos
      out.push({ measure, beat: 1 + (pos - from) / (WHOLE_TICKS / this.signatureAt(measure).beatType), ticks: take })
      pos += take
    }
    return out
  }
}
