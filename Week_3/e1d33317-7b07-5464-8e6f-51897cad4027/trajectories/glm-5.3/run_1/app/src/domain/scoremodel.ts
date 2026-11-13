import {
  compareStampsDesc,
  Clef,
  DurationName,
  MEASURE_CAP,
  Pitch,
  SetField,
  Stamp,
  TimeSignature,
  stampKey,
  isDuration,
  DynamicMark,
  Transpose,
} from './values.js';
import { Timeline, splitAcrossBarlines } from './timeline.js';
import { filterExpressionText, textWithinLimit } from './textfilter.js';
import { writtenPitch } from './pitch.js';

export interface StaffRecord {
  id: string;
  name: string;
  clef: Clef;
  transpose: Transpose;
  partId: string;
  order: number;
}

export interface PartRecord {
  id: string;
  name: string;
  staffIds: string[];
}

export interface ElementId extends Stamp {}

export interface StoredEvent {
  id: ElementId;
  staffId: string;
  voice: number;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  tie: boolean;
  dynamic: string | null;
  dynamicPlacement: 'above' | 'below';
  text: string | null;
  deleted: boolean;
  after: ElementId | null;
  deletedAt: Stamp | null;
  sets: Partial<Record<SetField, { value: unknown; stamp: Stamp }>>;
}

export type Operation =
  | {
      id: ElementId;
      type: 'insert';
      staffId: string;
      voice: number;
      after: ElementId | null;
      event: { kind: 'note' | 'rest'; pitch?: Pitch; duration: DurationName; dots: number };
    }
  | { id: ElementId; type: 'delete'; staffId: string; voice: number; target: ElementId }
  | {
      id: ElementId;
      type: 'set';
      staffId: string;
      voice: number;
      target: ElementId;
      field: SetField;
      value: unknown;
    };

export interface ScoreDocument {
  id: string;
  title: string;
  staves: StaffRecord[];
  parts: PartRecord[];
  measureCount: number;
  timeSignatures: TimeSignature[];
  tempos: { measure: number; bpm: number }[];
  lamport: number;
  lastSeq: number;
}

export interface PositionedEvent {
  id: ElementId;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  ticks: number;
  tie: boolean;
  dynamic: string | null;
  dynamicPlacement: 'above' | 'below';
  text: string | null;
  measure: number;
  beat: number;
  pieces: { measure: number; beat: number; ticks: number }[];
}

export interface ApplyFailure {
  key: string;
  message: string;
}

export class InvalidOperation extends Error {
  constructor(readonly failures: ApplyFailure[]) {
    super(failures.map((f) => f.message).join(' '));
  }
}

/**
 * The authoritative in-memory score state: staves, parts, voices and the
 * operation results that produce the visible music. Field values follow the
 * latest-stamp rule and inserts the greater-stamp-first rule, so every
 * replica that sees the same operations converges on the same document.
 */
export class ScoreModel {
  private events = new Map<string, StoredEvent>();
  readonly id: string;
  readonly title: string;
  lamport: number;
  lastSeq = 0;
  measureCount: number;
  timeSignatures: TimeSignature[];
  tempos: { measure: number; bpm: number }[];
  staves: StaffRecord[];
  parts: PartRecord[];

  constructor(doc: ScoreDocument, events: StoredEvent[]) {
    this.id = doc.id;
    this.title = doc.title;
    this.lamport = doc.lamport;
    this.measureCount = doc.measureCount;
    this.timeSignatures = doc.timeSignatures;
    this.tempos = doc.tempos;
    this.staves = doc.staves;
    this.parts = doc.parts;
    for (const e of events) this.events.set(stampKey(e.id), e);
  }

  static keyOf(id: ElementId): string {
    return stampKey(id);
  }

  /** Applies a recorded operation to the model. Throws on structural violations. */
  applyRecorded(op: Operation): void {
    const key = stampKey(op.id);
    switch (op.type) {
      case 'insert': {
        const e: StoredEvent = {
          id: op.id,
          staffId: op.staffId,
          voice: op.voice,
          kind: op.event.kind,
          pitch: op.event.kind === 'note' ? op.event.pitch ?? null : null,
          duration: op.event.duration,
          dots: op.event.dots,
          tie: false,
          dynamic: null,
          dynamicPlacement: 'below',
          text: null,
          deleted: false,
          after: op.after,
          deletedAt: null,
          sets: {},
        };
        this.events.set(key, e);
        break;
      }
      case 'delete': {
        const target = this.events.get(stampKey(op.target));
        if (target && !target.deleted) {
          target.deleted = true;
          target.deletedAt = op.id;
        }
        break;
      }
      case 'set': {
        const target = this.events.get(stampKey(op.target));
        if (!target) break;
        const current = target.sets[op.field];
        if (!current || compareStampsDesc(op.id, current.stamp) < 0) {
          target.sets[op.field] = { value: op.value, stamp: op.id };
        }
        break;
      }
    }
    if (op.id.lamport > this.lamport) this.lamport = op.id.lamport;
  }

  /** Recomputes a staff's voice layout, splitting at barlines. */
  voiceEvents(staffId: string, voice: number, atWritten: boolean, transpose: Transpose): PositionedEvent[] {
    const timeline = new Timeline(this.timeSignatures);
    const staffEvents = [...this.events.values()]
      .filter((e) => e.staffId === staffId && e.voice === voice && !e.deleted)
      .sort((a, b) => compareStampsDesc(a.id, b.id));

    // chain events by `after` links starting from voice start
    const chains = new Map<string | null, StoredEvent[]>();
    for (const e of staffEvents) {
      const k = e.after ? stampKey(e.after) : null;
      const list = chains.get(k) ?? [];
      list.push(e);
      chains.set(k, list);
    }
    const ordered: StoredEvent[] = [];
    const visit = (after: string | null) => {
      const list = (chains.get(after) ?? []).slice().sort((a, b) => compareStampsDesc(a.id, b.id));
      for (const e of list) {
        ordered.push(e);
        visit(stampKey(e.id));
      }
    };
    visit(null);

    const out: PositionedEvent[] = [];
    let tick = 0;
    for (const e of ordered) {
      const ticks = durationTicksOf(e);
      const split = splitAcrossBarlines(tick, ticks, timeline, this.measureCount);
      const measureStart = timeline.offsetOfMeasure(timeline.measureOfTick(tick));
      const sig = timeline.signatureAt(timeline.measureOfTick(tick));
      out.push({
        id: e.id,
        kind: e.kind,
        pitch: e.kind === 'note' ? effectivePitch(e) : null,
        duration: e.duration,
        dots: e.dots,
        ticks,
        tie: effectiveTie(e),
        dynamic: effectiveDynamic(e),
        dynamicPlacement: effectivePlacement(e),
        text: effectiveText(e),
        measure: timeline.measureOfTick(tick),
        beat: beatOf(tick - measureStart, sig),
        pieces: split.pieces,
      });
      tick += ticks;
    }
    if (atWritten) {
      for (const ev of out) if (ev.pitch) ev.pitch = writtenPitch(ev.pitch, transpose);
    }
    return out;
  }

  /** The measure count this staff's voices need, derived from their music. */
  measureNeeds(): number {
    return this.measureCountNeededByVoices();
  }

  /**
   * The measure cap rule: music that needs more measures grows the score,
   * and anything past the cap is refused.
   */
  measureCountNeededByVoices(): number {
    const timeline = new Timeline(this.timeSignatures);
    const perVoice = new Map<string, StoredEvent[]>();
    for (const e of this.events.values()) {
      if (e.deleted) continue;
      const key = `${e.staffId}:${e.voice}`;
      const list = perVoice.get(key) ?? [];
      list.push(e);
      perVoice.set(key, list);
    }
    let maxMeasure = this.measureCount;
    for (const list of perVoice.values()) {
      let tick = 0;
      for (const e of orderedChain(list)) {
        tick += durationTicksOf(e);
      }
      if (tick > 0) {
        const lastTick = tick - 1;
        const m = timeline.measureOfTick(lastTick);
        if (m > maxMeasure) maxMeasure = m;
      }
    }
    return Math.min(maxMeasure, MEASURE_CAP);
  }

  visibleEvent(id: ElementId): StoredEvent | null {
    const e = this.events.get(stampKey(id));
    return e && !e.deleted ? e : null;
  }

  storedEvent(id: ElementId): StoredEvent | null {
    return this.events.get(stampKey(id)) ?? null;
  }

  tombstoneCount(): number {
    let n = 0;
    for (const e of this.events.values()) if (e.deleted) n++;
    return n;
  }

  /** A deep copy for simulating a batch without touching the live model. */
  fork(): ScoreModel {
    const copy: StoredEvent[] = [];
    for (const e of this.events.values()) {
      copy.push({
        ...e,
        pitch: e.pitch ? { ...e.pitch } : null,
        after: e.after ? { ...e.after } : null,
        deletedAt: e.deletedAt ? { ...e.deletedAt } : null,
        sets: Object.fromEntries(Object.entries(e.sets).map(([k, v]) => [k, { value: v.value, stamp: { ...v.stamp } }])),
      });
    }
    return new ScoreModel(this.document(), copy);
  }

  document(): ScoreDocument {
    return {
      id: this.id,
      title: this.title,
      staves: this.staves.map((s) => ({ ...s, transpose: { ...s.transpose } })),
      parts: this.parts.map((p) => ({ ...p, staffIds: [...p.staffIds] })),
      measureCount: this.measureCount,
      timeSignatures: this.timeSignatures.map((t) => ({ ...t })),
      tempos: this.tempos.map((t) => ({ ...t })),
      lamport: this.lamport,
      lastSeq: this.lastSeq,
    };
  }

  allEvents(): StoredEvent[] {
    return [...this.events.values()];
  }

  eventsInStaff(staffId: string): StoredEvent[] {
    return [...this.events.values()].filter((e) => e.staffId === staffId);
  }

  dropTombstonesBelow(stamp: Stamp): void {
    for (const [key, e] of this.events) {
      if (e.deleted && e.deletedAt && compareStampsDesc(stamp, e.deletedAt) >= 0) {
        this.events.delete(key);
      }
    }
  }

  staff(staffId: string): StaffRecord | null {
    return this.staves.find((s) => s.id === staffId) ?? null;
  }

  part(partId: string): PartRecord | null {
    return this.parts.find((p) => p.id === partId) ?? null;
  }
}

function durationTicksOf(e: StoredEvent): number {
  const base: Record<DurationName, number> = { whole: 1920, half: 960, quarter: 480, eighth: 240, '16th': 120, '32nd': 60 };
  const b = base[e.duration] ?? 480;
  return e.dots === 2 ? b * 1.75 : e.dots === 1 ? b * 1.5 : b;
}

function beatOf(offsetInMeasure: number, sig: TimeSignature): number {
  const unit = 1920 / sig.beatType;
  return Math.round((offsetInMeasure / unit + 1) * 1000) / 1000;
}

function effectivePitch(e: StoredEvent): Pitch | null {
  const set = e.sets['pitch'];
  if (set) return (set.value as Pitch) ?? e.pitch;
  return e.pitch;
}

function effectiveTie(e: StoredEvent): boolean {
  const set = e.sets['tie'];
  return set ? set.value === true : e.tie;
}

function effectiveDynamic(e: StoredEvent): string | null {
  const set = e.sets['dynamic'];
  return set ? ((set.value as string) ?? null) : e.dynamic;
}

function effectivePlacement(e: StoredEvent): 'above' | 'below' {
  const set = e.sets['dynamicPlacement'];
  return set ? (set.value === 'above' ? 'above' : 'below') : e.dynamicPlacement;
}

function effectiveText(e: StoredEvent): string | null {
  const set = e.sets['text'];
  return set ? ((set.value as string) ?? null) : e.text;
}

/** Chain a voice's events by their after-links into play order. */
export function orderedChain(events: StoredEvent[]): StoredEvent[] {
  const chains = new Map<string | null, StoredEvent[]>();
  for (const e of events) {
    const k = e.after ? stampKey(e.after) : null;
    const list = chains.get(k) ?? [];
    list.push(e);
    chains.set(k, list);
  }
  const ordered: StoredEvent[] = [];
  const visit = (after: string | null, depth: number) => {
    const list = (chains.get(after) ?? []).slice().sort((a, b) => compareStampsDesc(a.id, b.id));
    for (const e of list) {
      ordered.push(e);
      if (depth < 500) visit(stampKey(e.id), depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

export { filterExpressionText, textWithinLimit, isDuration, MEASURE_CAP };

export type { DynamicMark };