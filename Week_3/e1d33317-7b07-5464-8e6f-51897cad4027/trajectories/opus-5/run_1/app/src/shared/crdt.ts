import { MeterMap, compareStamps, eventTicks, idKey, stampWins } from './music.js';
import type {
  DurationName,
  DynamicMark,
  DynamicPlacement,
  ElementId,
  Operation,
  Pitch,
  SetField,
  VoiceEvent,
} from './types.js';

export interface FieldStamp {
  value: unknown;
  stamp: ElementId;
}

export interface ScoreElement {
  id: ElementId;
  after: ElementId | null;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
  fields: Partial<Record<SetField, FieldStamp>>;
  deleted: ElementId | null;
}

const ROOT = '';

/** One voice of one staff: a single sequence of notes and rests running from measure 1. */
export class VoiceDocument {
  private readonly elements = new Map<string, ScoreElement>();
  private readonly children = new Map<string, ElementId[]>();

  static from(elements: Iterable<ScoreElement>): VoiceDocument {
    const document = new VoiceDocument();
    for (const element of elements) document.adopt(element);
    return document;
  }

  private adopt(element: ScoreElement): void {
    this.elements.set(idKey(element.id), element);
    const parent = element.after ? idKey(element.after) : ROOT;
    const siblings = this.children.get(parent) ?? [];
    siblings.push(element.id);
    siblings.sort(compareStamps);
    this.children.set(parent, siblings);
  }

  has(id: ElementId): boolean {
    return this.elements.has(idKey(id));
  }

  get(id: ElementId): ScoreElement | undefined {
    return this.elements.get(idKey(id));
  }

  insert(
    id: ElementId,
    after: ElementId | null,
    kind: 'note' | 'rest',
    pitch: Pitch | null,
    duration: DurationName,
    dots: number,
  ): void {
    if (this.elements.has(idKey(id))) return;
    this.adopt({ id, after, kind, pitch, duration, dots, fields: {}, deleted: null });
  }

  remove(target: ElementId, stamp: ElementId): void {
    const element = this.elements.get(idKey(target));
    if (!element || element.deleted) return;
    element.deleted = stamp;
  }

  set(target: ElementId, field: SetField, value: unknown, stamp: ElementId): void {
    const element = this.elements.get(idKey(target));
    if (!element) return;
    const held = element.fields[field];
    if (held && !stampWins(stamp, held.stamp)) return;
    element.fields[field] = { value, stamp };
  }

  apply(op: Operation): void {
    if (op.type === 'insert') {
      this.insert(
        op.id,
        op.after,
        op.event.kind,
        op.event.pitch ?? null,
        op.event.duration,
        op.event.dots,
      );
    } else if (op.type === 'delete') {
      this.remove(op.target, op.id);
    } else {
      this.set(op.target, op.field, op.value, op.id);
    }
  }

  /** Every element in convergent order, tombstones included. */
  ordered(): ScoreElement[] {
    const out: ScoreElement[] = [];
    const walk = (parent: string): void => {
      for (const id of this.children.get(parent) ?? []) {
        const element = this.elements.get(idKey(id));
        if (element) out.push(element);
        walk(idKey(id));
      }
    };
    walk(ROOT);
    return out;
  }

  tombstones(): ScoreElement[] {
    return [...this.elements.values()].filter((element) => element.deleted !== null);
  }

  visible(): ScoreElement[] {
    return this.ordered().filter((element) => element.deleted === null);
  }

  resolvedDuration(element: ScoreElement): { duration: DurationName; dots: number } {
    const duration = (element.fields.duration?.value as DurationName | undefined) ?? element.duration;
    const dots = (element.fields.dots?.value as number | undefined) ?? element.dots;
    return { duration, dots };
  }

  resolvedPitch(element: ScoreElement): Pitch | null {
    if (element.kind === 'rest') return null;
    return (element.fields.pitch?.value as Pitch | undefined) ?? element.pitch;
  }

  totalTicks(): number {
    let total = 0;
    for (const element of this.visible()) {
      const { duration, dots } = this.resolvedDuration(element);
      total += eventTicks(duration, dots);
    }
    return total;
  }

  /** Offset of an element, counting only the visible music before it. */
  offsetOf(target: ElementId): number | null {
    let offset = 0;
    const key = idKey(target);
    for (const element of this.ordered()) {
      if (idKey(element.id) === key) return offset;
      if (element.deleted === null) {
        const { duration, dots } = this.resolvedDuration(element);
        offset += eventTicks(duration, dots);
      }
    }
    return null;
  }

  events(meter: MeterMap): VoiceEvent[] {
    const out: VoiceEvent[] = [];
    let offset = 0;
    for (const element of this.visible()) {
      const { duration, dots } = this.resolvedDuration(element);
      const ticks = eventTicks(duration, dots);
      const pieces = meter.split(offset, ticks);
      const first = pieces[0]!;
      out.push({
        id: element.id,
        kind: element.kind,
        pitch: this.resolvedPitch(element),
        duration,
        dots,
        ticks,
        tie: (element.fields.tie?.value as boolean | undefined) ?? false,
        dynamic: (element.fields.dynamic?.value as DynamicMark | undefined) ?? null,
        dynamicPlacement:
          element.kind === 'rest'
            ? null
            : ((element.fields.dynamicPlacement?.value as DynamicPlacement | undefined) ?? 'below'),
        text: (element.fields.text?.value as string | undefined) ?? '',
        measure: first.measure,
        beat: first.beat,
        pieces,
      });
      offset += ticks;
    }
    return out;
  }
}
