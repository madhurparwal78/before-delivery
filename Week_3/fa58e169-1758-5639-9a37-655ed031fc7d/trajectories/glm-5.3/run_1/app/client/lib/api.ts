import type { Craft, Side, Terms } from "../../common/types";

export interface CellData {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  repeat: string;
  rev: number;
}

export interface RowData {
  row: number;
  side: Side;
  used: number;
  made: number;
  state: "ok" | "error" | "empty";
  errors: string[];
  text: string;
  notes: number;
}

export interface ColourData {
  letter: string;
  name: string;
  hex: string;
}

export interface RepeatData {
  id: string;
  fromCol: number;
  toCol: number;
  fromRow: number;
  toRow: number;
  times: number;
}

export interface PatternData {
  id: string;
  name: string;
  craft: Craft;
  mode: "flat" | "round";
  terms: Terms | null;
  castOn: number;
  width: number;
  height: number;
  colours: ColourData[];
  repeats: RepeatData[];
  cells: CellData[];
  rows: RowData[];
  colourWarnings?: { row: number; message: string }[];
  version?: number;
  state?: "draft" | "published";
  latestVersion?: number;
  row?: number;
}

export interface TokenData {
  text: string;
  cols: number[];
  inRepeat: boolean;
}

export interface LineDetail {
  tokens: TokenData[];
}

export interface VersionSummary {
  version: number;
  note: string;
  savedOn: string;
  stitches: number;
}

export interface NoteData {
  row: number;
  text: string;
  tester: string;
  version: number;
}

export interface MeData {
  id: string;
  name: string;
  email: string;
  reduceMotion: boolean;
}

export interface ConfigData {
  today: string;
  timeZone: string;
  limits: Record<string, number>;
}

export interface PatternEntry {
  id: string;
  name: string;
  state: "draft" | "published";
  role: "owner" | "co-designer" | "tester";
}

export class ApiFail extends Error {
  constructor(
    public status: number,
    public payload: Record<string, unknown>,
  ) {
    super(String(payload.message ?? payload.error ?? "error"));
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers,
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) throw new ApiFail(response.status, payload);
  return payload as T;
}

export function makeOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function readingOrder(side: Side, width: number): number[] {
  const order: number[] = [];
  if (side === "WS") {
    for (let col = 1; col <= width; col++) order.push(col);
  } else {
    for (let col = width; col >= 1; col--) order.push(col);
  }
  return order;
}

export function sideForRow(mode: "flat" | "round", row: number): Side {
  if (mode === "round") return "RND";
  return row % 2 === 1 ? "RS" : "WS";
}
