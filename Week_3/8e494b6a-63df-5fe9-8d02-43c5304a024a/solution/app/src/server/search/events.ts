// A stored event as the search code sees it, and its two serialisations: the API shape and the segment line.
import { formatIso } from "../../shared/time";
import { analyze, positionSpan } from "./analysis";
import { displayFields, flatten, type Doc, type Scalar } from "./fields";

export type EventPhase = "hot" | "warm" | "archive";

export interface StoredEvent {
  id: string;
  generation: number;
  phase: EventPhase;
  ts: number;
  doc: Doc;
  pipeline: string | null;
  /** Insertion order of a live row; archived events have none. */
  ordinal: number | null;
  flat: Map<string, Scalar[]>;
}

export interface Mark {
  field: string;
  positions: number[];
}

export interface Explanation {
  value: number;
  text: string;
  children: Array<{ value: number; leaf: string; field: string; idf: number; tf_norm: number; boost: number; text: string }>;
}

export interface ApiEvent {
  _id: string;
  "@timestamp": string;
  _generation: number;
  _phase: EventPhase;
  _pipeline: string | null;
  _score: number | null;
  fields: Doc;
  highlights: Record<string, Array<[number, number]>>;
  explanation?: Explanation;
}

export function storedEvent(row: { id: string; generation: number; phase: EventPhase; ts: number; doc: Doc; pipeline: string | null; ordinal: number | null }): StoredEvent {
  return { ...row, flat: flatten(row.doc) };
}

/** Offsets of the tokens at `positions`, in the original text of each value of a text field. */
function highlightOffsets(values: Scalar[], positions: Set<number>): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  let base = 0;
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const token of analyze("standard", value)) {
      if (positions.has(base + token.position)) offsets.push([token.start, token.end]);
    }
    base += positionSpan("standard", value);
  }
  return offsets;
}

export function apiEvent(event: StoredEvent, score: number | null, marks: Mark[], explanation?: Explanation): ApiEvent {
  const highlights: Record<string, Array<[number, number]>> = {};
  for (const mark of marks) {
    const offsets = highlightOffsets(event.flat.get(mark.field) ?? [], new Set(mark.positions));
    if (offsets.length === 0) continue;
    const seen = new Set((highlights[mark.field] ?? []).map(([a, b]) => `${a}:${b}`));
    highlights[mark.field] = [...(highlights[mark.field] ?? []), ...offsets.filter(([a, b]) => !seen.has(`${a}:${b}`))];
  }
  const shown: ApiEvent = {
    _id: event.id,
    "@timestamp": formatIso(event.ts),
    _generation: event.generation,
    _phase: event.phase,
    _pipeline: event.pipeline,
    _score: score,
    fields: displayFields(event.doc),
    highlights,
  };
  if (explanation) shown.explanation = explanation;
  return shown;
}

/** One line of a segment object: the event JSON with its identity and timestamp beside its fields. */
export function segmentLine(event: Pick<StoredEvent, "id" | "ts" | "doc" | "pipeline">): string {
  const line: Doc = { _id: event.id, "@timestamp": formatIso(event.ts), ...event.doc };
  if (event.pipeline) line._pipeline = event.pipeline;
  return JSON.stringify(line);
}

export function parseSegment(text: string, generation: number): StoredEvent[] {
  const events: StoredEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const { _id, "@timestamp": stamp, _pipeline, ...doc } = JSON.parse(line) as Doc;
    events.push(storedEvent({
      id: String(_id), generation, phase: "archive", ts: Date.parse(String(stamp)), doc,
      pipeline: typeof _pipeline === "string" ? _pipeline : null, ordinal: null,
    }));
  }
  return events;
}
