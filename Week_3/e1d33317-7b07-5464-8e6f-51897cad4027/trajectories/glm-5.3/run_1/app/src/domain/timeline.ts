import {
  DurationName,
  TimeSignature,
  durationTicks,
  measureTicks,
  beatsToTicks,
  tickToBeat,
  formatBeat,
} from './values.js';

export interface EventCore {
  kind: 'note' | 'rest';
  duration: DurationName;
  dots: number;
}

export interface EventPiece {
  measure: number;
  beat: number;
  ticks: number;
}

/**
 * The one place that decides how a voice's music lays out over measures.
 * It turns an ordered list of timed events into absolute positions, splits
 * anything that crosses a barline into tied pieces, and reports how many
 * measures the music needs.
 */
export class Timeline {
  readonly timeSignatures: TimeSignature[];
  readonly startMeasure: number;

  constructor(timeSignatures: TimeSignature[], startMeasure = 1) {
    this.timeSignatures = [...timeSignatures].sort((a, b) => a.measure - b.measure);
    this.startMeasure = startMeasure;
  }

  /** Time signature in force at a measure. */
  signatureAt(measure: number): TimeSignature {
    let current = this.timeSignatures[0] ?? { measure: 1, beats: 4, beatType: 4 };
    for (const ts of this.timeSignatures) {
      if (ts.measure <= measure) current = ts;
      else break;
    }
    return current;
  }

  ticksOfMeasure(measure: number): number {
    return measureTicks(this.signatureAt(measure).beats, this.signatureAt(measure).beatType);
  }

  /** Total ticks from the first measure up to (not including) a measure. */
  offsetOfMeasure(measure: number): number {
    let ticks = 0;
    for (let m = this.startMeasure; m < measure; m++) ticks += this.ticksOfMeasure(m);
    return ticks;
  }

  measureOfTick(tick: number): number {
    let m = this.startMeasure;
    let remaining = Math.floor(tick);
    for (;;) {
      const size = this.ticksOfMeasure(m);
      if (remaining < size) return m;
      remaining -= size;
      m++;
    }
  }
}

export interface PositionedEvent extends EventCore {
  startTick: number;
  endTick: number;
  pieces: EventPiece[];
  measure: number;
  beat: number;
}

export interface TimelineEntry {
  event: EventCore;
  startTick: number;
  durationTicks: number;
}

export interface PieceSplit {
  measure: number;
  beat: number;
  ticks: number;
}

/**
 * Splits a timed event's span into measures, returning one piece per measure
 * it touches. Pieces are tied; engraving re-chunks them into standard values.
 */
export function splitAcrossBarlines(
  startTick: number,
  durationTicks: number,
  timeline: Timeline,
  maxMeasure: number,
): { pieces: PieceSplit[]; needsMeasures: number } {
  const pieces: PieceSplit[] = [];
  let cursor = Math.max(0, startTick);
  const end = cursor + durationTicks;
  let lastMeasure = 0;
  while (cursor < end) {
    const measure = timeline.measureOfTick(cursor);
    const measureStart = timeline.offsetOfMeasure(measure);
    const measureEnd = measureStart + timeline.ticksOfMeasure(measure);
    const pieceEnd = Math.min(end, measureEnd);
    const ticks = pieceEnd - cursor;
    if (ticks > 0) {
      const sig = timeline.signatureAt(measure);
      pieces.push({
        measure,
        beat: tickToBeat(cursor - measureStart, sig.beatType),
        ticks,
      });
      lastMeasure = measure;
    }
    cursor = pieceEnd;
    if (cursor < end && measure >= maxMeasure) break; // capped: truncate at the cap
  }
  return { pieces, needsMeasures: lastMeasure };
}

/** The fewest tied standard values, longest first, that make up a tick count. */
export function chunkTicks(totalTicks: number): { duration: DurationName; dots: number; ticks: number }[] {
  const bases: [DurationName, number][] = [
    ['whole', 1920],
    ['half', 960],
    ['quarter', 480],
    ['eighth', 240],
    ['16th', 120],
    ['32nd', 60],
  ];
  const dotted = (t: number) => t * 1.5;
  const doubleDotted = (t: number) => t * 1.75;
  const out: { duration: DurationName; dots: number; ticks: number }[] = [];
  let remaining = Math.round(totalTicks);
  const guard = 200;
  let steps = 0;
  while (remaining > 0 && steps < guard) {
    steps++;
    let found: { duration: DurationName; dots: number; ticks: number } | null = null;
    for (const [name, base] of bases) {
      for (const dots of [0, 1, 2]) {
        const t = Math.round(dots === 0 ? base : dots === 1 ? dotted(base) : doubleDotted(base));
        if (t <= remaining && (!found || t > found.ticks)) {
          found = { duration: name, dots, ticks: t };
        }
      }
    }
    if (!found) {
      // remainder smaller than a 32nd: extend the previous piece
      if (out.length > 0) {
        out[out.length - 1].ticks += remaining;
      } else {
        out.push({ duration: '32nd', dots: 0, ticks: remaining });
      }
      break;
    }
    out.push(found);
    remaining -= found.ticks;
  }
  return out;
}

export { durationTicks, beatsToTicks, measureTicks, tickToBeat, formatBeat };
