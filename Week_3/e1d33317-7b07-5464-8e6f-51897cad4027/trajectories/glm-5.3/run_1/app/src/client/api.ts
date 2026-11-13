export interface Pitch {
  step: string;
  alter: number;
  octave: number;
}

export interface Stamp {
  lamport: number;
  site: string;
}

export interface Staff {
  id: string;
  name: string;
  clef: 'treble' | 'alto' | 'tenor' | 'bass' | 'percussion';
  transpose: { diatonic: number; chromatic: number };
  partId: string;
  order: number;
}

export interface Part {
  id: string;
  name: string;
  staffIds: string[];
  status: 'draft' | 'engraving' | 'rendering' | 'ready' | 'pdf_pending';
  revision: number;
  extractedAtLamport: number | null;
  stale: boolean;
  pageCount: number | null;
  layout: { systemBreaks: number[]; pageBreaks: number[] };
  lastError: string | null;
}

export interface Score {
  id: string;
  title: string;
  measureCount: number;
  timeSignatures: { measure: number; beats: number; beatType: number }[];
  tempos: { measure: number; bpm: number }[];
  staves: Staff[];
  parts: Part[];
  lamport: number;
  lastSeq: number;
}

export interface Collaborator {
  id: string;
  name: string;
  role: 'composer' | 'copyist' | 'player';
  status: 'invited' | 'active' | 'removed';
  staffIds: string[];
}

export interface VoiceEvent {
  id: Stamp;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: string;
  dots: number;
  ticks: number;
  tie: boolean;
  dynamic: string | null;
  dynamicPlacement: 'above' | 'below' | null;
  text: string | null;
  measure: number;
  beat: number;
  pieces: { measure: number; beat: number; ticks: number }[];
}

export interface Bank {
  id: string;
  fileName: string;
  kind: 'wav' | 'sfz';
  bytes: number;
  staffId: string;
  rootPitch: string | null;
  status: string;
  createdAt: string;
}

export interface HistoryEntry {
  seq: number;
  opId: Stamp;
  type: string;
  field: string | null;
  staffId: string;
  staffName: string;
  voice: number;
  measure: number;
  beat: number;
  author: { id: string; name: string; role: string };
  at: string;
  summary: string;
}

export interface EngravedSystem {
  index: number;
  page: number;
  firstMeasure: number;
  lastMeasure: number;
  svg: string;
}

export interface Hold {
  staffId: string;
  holder: { id: string; name: string; role: string };
  since: string;
}

export interface PresenceEntry {
  collaboratorId: string;
  name: string;
  role: string;
  cursor: { staffId: string; measure: number; beat: number } | null;
}

export interface ApiErrorShape {
  error: string;
  message: string;
  errors?: Record<string, string>;
  heldBy?: { id: string; name: string; role: string };
  staffIds?: string[];
  retryAfterSeconds?: number;
  status?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorShape,
  ) {
    super(body.message);
  }
}

function token(): string | null {
  return sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat');
}

export function setToken(value: string): void {
  sessionStorage.setItem('fairline-seat', value);
  localStorage.setItem('fairline-seat', value);
}

export function clearToken(): void {
  sessionStorage.removeItem('fairline-seat');
  localStorage.removeItem('fairline-seat');
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const seat = token();
  if (seat) headers['Authorization'] = `Bearer ${seat}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text.length > 0 && (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text;
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorShape);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  me: () => request<{ collaborator: Collaborator; score: { id: string; title: string } }>('GET', '/api/me'),
};
