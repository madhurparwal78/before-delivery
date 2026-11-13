import type {
  DurationName,
  ElementId,
  EventPiece,
  Pitch,
  TimeSignature,
  Transpose,
} from './types.js';

export const DURATION_TICKS: Record<DurationName, number> = {
  whole: 1920,
  half: 960,
  quarter: 480,
  eighth: 240,
  '16th': 120,
  '32nd': 60,
};

export const DURATION_NAMES: DurationName[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
];

const DURATION_WORDS: Record<DurationName, string> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': 'sixteenth',
  '32nd': 'thirty-second',
};

export const MAX_STAVES = 64;
export const MAX_MEASURES = 2000;
export const WHOLE_TICKS = 1920;

export function eventTicks(duration: DurationName, dots: number): number {
  const base = DURATION_TICKS[duration];
  if (dots === 1) return base + base / 2;
  if (dots === 2) return base + base / 2 + base / 4;
  return base;
}

export function durationWord(duration: DurationName, dots: number): string {
  const prefix = dots === 1 ? 'dotted ' : dots === 2 ? 'double-dotted ' : '';
  return `${prefix}${DURATION_WORDS[duration]}`;
}

export function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

const ACCIDENTAL_SIGNS = new Map<number, string>([
  [-2, '\u{1D12B}'],
  [-1, '\u266D'],
  [0, ''],
  [1, '\u266F'],
  [2, '\u{1D12A}'],
]);

export function accidentalSign(alter: number): string {
  return ACCIDENTAL_SIGNS.get(alter) ?? '';
}

export function formatPitch(pitch: Pitch): string {
  return `${pitch.step}${accidentalSign(pitch.alter)} ${pitch.octave}`;
}

export function formatBeat(beat: number): string {
  const rounded = Math.round(beat * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

const STEP_SEMITONES: Record<Pitch['step'], number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const STEP_ORDER: Pitch['step'][] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function stepIndex(step: Pitch['step']): number {
  return STEP_ORDER.indexOf(step);
}

/** Diatonic position, counting C0 as 0, used for staff placement and spelling order. */
export function diatonicIndex(pitch: Pitch): number {
  return pitch.octave * 7 + stepIndex(pitch.step);
}

export function pitchToMidi(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + STEP_SEMITONES[pitch.step] + pitch.alter;
}

/** Every spelling of one sounding pitch with an accidental up to a double sharp or flat, lowest first. */
export function enharmonicSpellings(midi: number): Pitch[] {
  const found: Pitch[] = [];
  for (const step of STEP_ORDER) {
    for (let alter = -2; alter <= 2; alter += 1) {
      const remainder = midi - STEP_SEMITONES[step] - alter;
      if (remainder % 12 !== 0) continue;
      const octave = remainder / 12 - 1;
      if (octave < 0 || octave > 9) continue;
      found.push({ step, alter, octave });
    }
  }
  return found.sort((a, b) => diatonicIndex(a) - diatonicIndex(b));
}

export function nextSpelling(pitch: Pitch): Pitch {
  const candidates = enharmonicSpellings(pitchToMidi(pitch));
  const here = candidates.findIndex(
    (c) => c.step === pitch.step && c.alter === pitch.alter && c.octave === pitch.octave,
  );
  return candidates[(here + 1) % candidates.length]!;
}

/** A semitone move, spelled natural where possible, otherwise sharp upwards and flat downwards. */
export function moveSemitone(pitch: Pitch, direction: 1 | -1): Pitch {
  const midi = pitchToMidi(pitch) + direction;
  const candidates = enharmonicSpellings(midi);
  const natural = candidates.find((c) => c.alter === 0);
  if (natural) return natural;
  const wanted = direction === 1 ? 1 : -1;
  return candidates.find((c) => c.alter === wanted) ?? candidates[0]!;
}

export function moveOctave(pitch: Pitch, direction: 1 | -1): Pitch {
  return { ...pitch, octave: pitch.octave + direction };
}

export function transposePitch(pitch: Pitch, transpose: Transpose, sign: 1 | -1): Pitch {
  const diatonic = diatonicIndex(pitch) + sign * transpose.diatonic;
  const midi = pitchToMidi(pitch) + sign * transpose.chromatic;
  const octave = Math.floor(diatonic / 7);
  const step = STEP_ORDER[((diatonic % 7) + 7) % 7]!;
  const alter = midi - ((octave + 1) * 12 + STEP_SEMITONES[step]);
  return { step, alter, octave };
}

/** The middle line of each clef, used when a voice has no previous note. */
export const CLEF_MIDDLE_PITCH: Record<string, Pitch> = {
  treble: { step: 'B', alter: 0, octave: 4 },
  percussion: { step: 'B', alter: 0, octave: 4 },
  alto: { step: 'C', alter: 0, octave: 4 },
  tenor: { step: 'A', alter: 0, octave: 3 },
  bass: { step: 'D', alter: 0, octave: 3 },
};

/** The octave that puts a step nearest, in staff steps, to a reference pitch. */
export function nearestOctave(step: Pitch['step'], reference: Pitch): number {
  const target = diatonicIndex(reference);
  let best = reference.octave;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let octave = Math.max(0, reference.octave - 1); octave <= Math.min(9, reference.octave + 1); octave += 1) {
    const distance = Math.abs(octave * 7 + stepIndex(step) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = octave;
    }
  }
  return best;
}

/** The bar lengths of a score, extending past the last written measure with the last signature. */
export class MeterMap {
  private readonly starts: number[] = [0];

  constructor(private readonly signatures: TimeSignature[]) {}

  signatureAt(measure: number): TimeSignature {
    let found = this.signatures[0]!;
    for (const signature of this.signatures) {
      if (signature.measure <= measure) found = signature;
    }
    return found;
  }

  signatureMeasures(): number[] {
    return this.signatures.map((signature) => signature.measure);
  }

  beatTicks(measure: number): number {
    return WHOLE_TICKS / this.signatureAt(measure).beatType;
  }

  measureTicks(measure: number): number {
    const signature = this.signatureAt(measure);
    return signature.beats * (WHOLE_TICKS / signature.beatType);
  }

  /** Ticks from the start of the score to the start of this measure. */
  measureStart(measure: number): number {
    while (this.starts.length < measure) {
      const known = this.starts.length;
      this.starts.push(this.starts[known - 1]! + this.measureTicks(known));
    }
    return this.starts[measure - 1]!;
  }

  locate(offset: number): { measure: number; tickInMeasure: number } {
    let measure = 1;
    let start = 0;
    for (;;) {
      const length = this.measureTicks(measure);
      if (offset < start + length) return { measure, tickInMeasure: offset - start };
      start += length;
      measure += 1;
    }
  }

  beatAt(measure: number, tickInMeasure: number): number {
    const signature = this.signatureAt(measure);
    const beatTicks = WHOLE_TICKS / signature.beatType;
    return 1 + tickInMeasure / beatTicks;
  }

  position(offset: number): { measure: number; beat: number } {
    const { measure, tickInMeasure } = this.locate(offset);
    return { measure, beat: this.beatAt(measure, tickInMeasure) };
  }

  /** The barline split: an event crossing a barline becomes tied pieces, one per measure. */
  split(offset: number, ticks: number): EventPiece[] {
    const pieces: EventPiece[] = [];
    let remaining = ticks;
    let cursor = offset;
    while (remaining > 0) {
      const { measure, tickInMeasure } = this.locate(cursor);
      const room = this.measureTicks(measure) - tickInMeasure;
      const taken = Math.min(room, remaining);
      pieces.push({
        measure,
        beat: this.beatAt(measure, tickInMeasure),
        ticks: taken,
      });
      remaining -= taken;
      cursor += taken;
    }
    return pieces;
  }

  measuresNeeded(totalTicks: number): number {
    if (totalTicks <= 0) return 1;
    let measure = 1;
    let start = 0;
    for (;;) {
      const length = this.measureTicks(measure);
      if (totalTicks <= start + length) return measure;
      start += length;
      measure += 1;
      if (measure > MAX_MEASURES + 1) return measure;
    }
  }
}

interface StandardValue {
  duration: DurationName;
  dots: number;
  ticks: number;
}

const STANDARD_VALUES: StandardValue[] = DURATION_NAMES.flatMap((duration) =>
  [2, 1, 0].map((dots) => ({ duration, dots, ticks: eventTicks(duration, dots) })),
).sort((a, b) => b.ticks - a.ticks);

/** Draw a piece with the fewest tied standard values, longest first. */
export function decomposeTicks(ticks: number): StandardValue[] {
  const parts: StandardValue[] = [];
  let remaining = ticks;
  while (remaining > 0) {
    const value = STANDARD_VALUES.find((candidate) => candidate.ticks <= remaining);
    if (!value) break;
    parts.push(value);
    remaining -= value.ticks;
  }
  return parts;
}

export function idKey(id: ElementId): string {
  return `${id.lamport}@${id.site}`;
}

/** Later stamps come first among inserts after the same element; ties break on site, greater first. */
export function compareStamps(a: ElementId, b: ElementId): number {
  if (a.lamport !== b.lamport) return b.lamport - a.lamport;
  if (a.site === b.site) return 0;
  return a.site > b.site ? -1 : 1;
}

/** The set operation with the greatest stamp wins a field. */
export function stampWins(challenger: ElementId, holder: ElementId): boolean {
  if (challenger.lamport !== holder.lamport) return challenger.lamport > holder.lamport;
  return challenger.site > holder.site;
}
