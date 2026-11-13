// Explore's shared types and the codec between the address bar and the search state.
export interface Highlights { [field: string]: Array<[number, number]> }

interface ExplanationChild { value: number; text: string }
export interface ExplanationRoot { value: number; text: string; children: ExplanationChild[] }

export interface ApiEvent {
  _id: string;
  "@timestamp": string;
  _generation: number;
  _phase: "hot" | "warm" | "archive";
  _pipeline: string | null;
  _score: number | null;
  fields: Record<string, unknown>;
  highlights: Highlights;
  explanation?: ExplanationRoot;
}

export type PillValue = string | number | boolean;

export interface Pill {
  field: string;
  value: PillValue;
  mode: "include" | "exclude";
  enabled: boolean;
}

export interface SearchState {
  stream: string;
  q: string;
  from: string;
  to: string;
  pills: Pill[];
  sort: string | null;
}

export interface FieldInfo { field: string; type: string; conflict?: string }
export interface Bucket { start: string; end: string; count: number; label: string }
export interface Stats { field: string; present: number; total: number; top: Array<{ value: PillValue; count: number; share: string }> }

export const pillFilters = (pills: Pill[]): Array<{ field: string; op: "eq" | "ne"; value: PillValue }> =>
  pills.filter((pill) => pill.enabled).map((pill) => ({ field: pill.field, op: pill.mode === "include" ? "eq" : "ne", value: pill.value }));

export const pillLabel = (pill: Pill): string =>
  `Filter ${pill.field}: ${pill.value}, ${pill.mode}, ${pill.enabled ? "enabled" : "disabled"}`;

export function encodeState(state: SearchState): string {
  const params = new URLSearchParams({ stream: state.stream, from: state.from, to: state.to });
  if (state.q) params.set("q", state.q);
  if (state.pills.length > 0) params.set("filters", JSON.stringify(state.pills));
  if (state.sort) params.set("sort", state.sort);
  return `/explore?${params.toString()}`;
}

export function decodePills(raw: string | null): Pill[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Pill[]).filter((p) => typeof p.field === "string" && (p.mode === "include" || p.mode === "exclude")) : [];
  } catch {
    return [];
  }
}

export const countSentence = (n: number): string => `${n} ${n === 1 ? "event" : "events"} found`;

export const cellText = (value: unknown): string => (value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value));

export const DEFAULT_COLUMNS = ["@timestamp", "host", "level", "message"];
export const columnWidth = (column: string): number => (column === "message" ? 480 : 160);
