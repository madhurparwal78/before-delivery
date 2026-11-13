import { Clef, Pitch, Transpose } from './values.js';

const STEP_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SEMITONE_TO_STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
type Letter = (typeof SEMITONE_TO_STEP)[number];

function letterOf(step: string): Letter {
  return step as Letter;
}

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_TO_SEMITONE[p.step] + p.alter;
}

const ACCIDENTAL_SIGNS: Record<number, string> = {
  [-2]: '𝄫',
  [-1]: '♭',
  0: '',
  1: '♯',
  2: '𝄪',
};

export function accidentalSign(alter: number): string {
  return ACCIDENTAL_SIGNS[alter] ?? '';
}

/** "<pitch>" form: letter, accidental sign, space, octave. */
export function formatPitch(p: Pitch): string {
  return `${p.step}${accidentalSign(p.alter)} ${p.octave}`;
}

const DURATION_WORDS: Record<string, { one: string; cap: string }> = {
  whole: { one: 'whole', cap: 'Whole' },
  half: { one: 'half', cap: 'Half' },
  quarter: { one: 'quarter', cap: 'Quarter' },
  eighth: { one: 'eighth', cap: 'Eighth' },
  '16th': { one: 'sixteenth', cap: 'Sixteenth' },
  '32nd': { one: 'thirty-second', cap: 'Thirty-second' },
};

/** "<duration>" form: dotted/double-dotted prefix plus the duration word. */
export function formatDuration(duration: string, dots: number): string {
  const word = DURATION_WORDS[duration]?.one ?? duration;
  const prefix = dots === 2 ? 'double-dotted ' : dots === 1 ? 'dotted ' : '';
  return prefix + word;
}

/** Duration word with the capitalisation used for rest announcements. */
export function formatDurationCap(duration: string, dots: number): string {
  const word = DURATION_WORDS[duration]?.cap ?? duration;
  return dots === 2 ? `Double-dotted ${word}` : dots === 1 ? `Dotted ${word}` : word;
}

/** Diatonic step index (0 for C) plus octaves, used for staff-step distance. */
export function diatonicIndex(p: Pitch): number {
  const stepIndex = SEMITONE_TO_STEP.indexOf(letterOf(p.step));
  return p.octave * 7 + stepIndex;
}

export function fromDiatonicIndex(index: number, alter: number): Pitch {
  const octave = Math.floor(index / 7);
  const stepIndex = ((index % 7) + 7) % 7;
  return { step: SEMITONE_TO_STEP[stepIndex], alter, octave };
}

export function stepFromLetter(letter: string): string {
  return letter.toUpperCase();
}

const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Move a pitch by semitones, spelled natural where possible, else ♯ up / ♭ down. */
export function moveBySemitone(p: Pitch, semitones: number): Pitch {
  if (semitones === 0) return p;
  const midi = pitchToMidi(p) + semitones;
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const midiClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const natural = letters.find((l) => LETTER_SEMITONE[l] === midiClass);
  if (natural) return { step: natural, alter: 0, octave };
  if (semitones > 0) {
    const belowClass = (midiClass - 1 + 12) % 12;
    const below = letters.find((l) => LETTER_SEMITONE[l] === belowClass) ?? 'C';
    return { step: below, alter: 1, octave };
  }
  const aboveClass = (midiClass + 1) % 12;
  const above = letters.find((l) => LETTER_SEMITONE[l] === aboveClass) ?? 'B';
  return { step: above, alter: -1, octave };
}

/** Move a pitch an octave, keeping its spelling. */
export function moveByOctave(p: Pitch, octaves: number): Pitch {
  return { ...p, octave: p.octave + octaves };
}

/** Every spelling of the same sounding pitch with accidental at most a double sharp or double flat. */
export function enharmonicSpellings(p: Pitch): Pitch[] {
  const midi = pitchToMidi(p);
  const out: Pitch[] = [];
  for (const step of SEMITONE_TO_STEP) {
    for (const alter of [-2, -1, 0, 1, 2]) {
      const octave = midiToOctave(step, alter, midi);
      if (octave === null) continue;
      out.push({ step, alter, octave });
    }
  }
  // ordered from the lowest letter-and-octave to the highest
  out.sort((a, b) => {
    const da = diatonicIndex(a);
    const db = diatonicIndex(b);
    if (da !== db) return da - db;
    return a.alter - b.alter;
  });
  return out;
}

function midiToOctave(step: string, alter: number, midi: number): number | null {
  for (let octave = 0; octave <= 9; octave++) {
    if ((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter === midi) return octave;
  }
  return null;
}

export function respellNext(p: Pitch): Pitch {
  const list = enharmonicSpellings(p);
  const i = list.findIndex((sp) => sp.step === p.step && sp.alter === p.alter && sp.octave === p.octave);
  if (i === -1) return list[0] ?? p;
  return list[(i + 1) % list.length];
}

/** The staff's middle line pitch used when a voice has no previous note. */
export function middleLinePitch(clef: Clef): Pitch {
  switch (clef) {
    case 'treble':
    case 'percussion':
      return { step: 'B', alter: 0, octave: 4 };
    case 'alto':
      return { step: 'C', alter: 0, octave: 4 };
    case 'tenor':
      return { step: 'A', alter: 0, octave: 3 };
    case 'bass':
      return { step: 'D', alter: 0, octave: 3 };
  }
}

/** Nearest octave of a letter to a target pitch, measured in staff steps. */
export function nearestOctaveOfLetter(letter: string, target: Pitch): Pitch {
  const step = stepFromLetter(letter);
  let best: Pitch = { step, alter: 0, octave: 4 };
  let bestDist = Infinity;
  for (let octave = 0; octave <= 9; octave++) {
    const candidate: Pitch = { step, alter: 0, octave };
    const dist = Math.abs(diatonicIndex(candidate) - diatonicIndex(target));
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** sounding = written + transpose; so written = sounding − transpose. */
export function writtenPitch(sounding: Pitch, transpose: Transpose): Pitch {
  const diatonic = diatonicIndex(sounding) - transpose.diatonic;
  const midi = pitchToMidi(sounding) - transpose.chromatic;
  const stepIndex = ((diatonic % 7) + 7) % 7;
  const octave = Math.floor(diatonic / 7);
  const step = SEMITONE_TO_STEP[stepIndex];
  const naturalMidi = (octave + 1) * 12 + LETTER_SEMITONE[step];
  const alter = midi - naturalMidi;
  return { step, alter, octave };
}

export function concertPitch(written: Pitch, transpose: Transpose): Pitch {
  const diatonic = diatonicIndex(written) + transpose.diatonic;
  const midi = pitchToMidi(written) + transpose.chromatic;
  const stepIndex = ((diatonic % 7) + 7) % 7;
  const octave = Math.floor(diatonic / 7);
  const step = SEMITONE_TO_STEP[stepIndex];
  const naturalMidi = (octave + 1) * 12 + LETTER_SEMITONE[step];
  const alter = midi - naturalMidi;
  return { step, alter, octave };
}
