import type { Cell, ColourDef, RepeatBox } from '../../src/domain/types';

export interface ApiFailureBody {
  error: string;
  field?: string;
  message?: string;
  position?: number | null;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiFailureBody,
  ) {
    super(body.error);
  }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) throw new ApiFailure(response.status, body as ApiFailureBody);
  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    send<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    send<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: <T>(path: string): Promise<T> => send<T>(path, { method: 'DELETE' }),
};

export interface Account {
  id: string;
  name: string;
  email: string;
  reduceMotion: boolean;
}

export interface Limits {
  maxChartRows: number;
  maxChartCols: number;
  maxColours: number;
  coloursPerRow: number;
  maxFloat: number;
  undoDepth: number;
  noteMaxChars: number;
  editsPerMinute: number;
  sheetLinesPerPage: number;
  noticeSeconds: number;
  rowMotionMs: number;
  presenceTtlSeconds: number;
  inviteTtlHours: number;
  verifyTtlHours: number;
}

export interface PublicConfig {
  today: string;
  timeZone: string;
  limits: Limits;
}

export interface RowData {
  row: number;
  side: 'RS' | 'WS' | 'RND';
  used: number;
  made: number;
  state: 'ok' | 'error' | 'empty';
  errors: string[];
  text: string;
  notes?: number;
}

export interface ColourWarning {
  row: number;
  message: string;
}

export interface TesterData {
  id: string;
  name: string;
  version: number;
  row: number;
  notes: number;
}

export interface PatternData {
  id: string;
  name: string;
  craft: 'knit' | 'crochet';
  mode: 'flat' | 'round';
  terms: 'us' | 'uk' | null;
  castOn: number;
  width: number;
  height: number;
  colours: ColourDef[];
  repeats: RepeatBox[];
  cells: Cell[];
  rows: RowData[];
  colourWarnings: ColourWarning[];
  version: number;
  state: 'draft' | 'published';
  testers: TesterData[];
}

export interface FollowData extends Omit<PatternData, 'colourWarnings' | 'version' | 'state' | 'testers'> {
  version: number;
  latestVersion: number;
  row: number;
}

export interface PublicData extends Omit<PatternData, 'colourWarnings' | 'state' | 'testers'> {
  version: number;
}

export interface VersionData {
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

export interface CompareData {
  a: number;
  b: number;
  rowsChanged: number;
  rowsAdded: number;
  rowsRemoved: number;
  cellsChanged: number;
  stitchesFrom: number;
  stitchesTo: number;
  summary: string;
  cells: { row: number; col: number; stitch: string; colour: string; diff: 'added' | 'changed' | 'same' }[];
}

export interface CellEditResult {
  applied: { row: number; col: number; rev: number }[];
  conflicts: { row: number; col: number; by: string; stitch: string; colour: string; rev: number }[];
  rows: RowData[];
}

export interface MirrorResult {
  applied: { row: number; col: number; stitch: string; colour: string; rev: number }[];
  conflicts: [];
  rows: RowData[];
}

export interface TextResult {
  changed: number;
  cells: Cell[];
  rows: RowData[];
}
