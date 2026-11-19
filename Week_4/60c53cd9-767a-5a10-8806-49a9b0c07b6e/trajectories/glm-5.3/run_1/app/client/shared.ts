// Shared client-side helpers: API calls, sales-office time formatting that
// matches the server rule, and derived figures. These mirror the one published
// rule, so the browser never invents its own time labels (DP-61).

export interface PublicUnit {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: string;
  price: number;
  pricePerM2: number;
  pricePerSqft: number;
  priceVersion: number;
  status: 'available' | 'held' | 'reserved';
  syncing: boolean;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface SearchReply {
  total: number;
  hits: PublicUnit[];
  facets: Record<string, Record<string, number>>;
  priceStats: { min: number; max: number } | null;
  matchingCodes: string[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

let serverOffset = 0;

export function recordServerTime(response: Response): void {
  const dateHeader = response.headers.get('date');
  if (!dateHeader) return;
  const serverTime = Date.parse(dateHeader);
  if (Number.isFinite(serverTime)) {
    serverOffset = serverTime - Date.now();
  }
}

export function serverNow(): number {
  return Date.now() + serverOffset;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  recordServerTime(response);
  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const errorBody = body && body.error ? body.error : { code: 'unknown', message: 'Something went wrong.' };
    throw new ApiError(response.status, errorBody.code, errorBody.message, errorBody.fields);
  }
  return body as T;
}

// Sales-office time (Business rules). The browser applies the same one rule as
// the server and never relies on its own short zone names.
export function salesOfficeTime(ms: number, tz: string): string {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const offset = zoneOffsetMinutes(d, tz);
  const abbr = offset === 660 ? 'AEDT' : offset === 600 ? 'AEST' : utcLabel(offset);
  return `${get('weekday')} ${get('day')} ${get('month')} ${hour}:${get('minute')} ${abbr}`;
}

function utcLabel(offset: number): string {
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function zoneOffsetMinutes(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUTC - d.getTime()) / 60000);
}

export function countdownClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function priceText(n: number): string {
  return n.toLocaleString('en-AU');
}

export const STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  held: 'Held',
  reserved: 'Reserved',
  withdrawn: 'Withdrawn',
  unreleased: 'Not released',
};

export const BAND_LABELS: Record<string, string> = {
  '03-09': 'Floors 3-9',
  '10-19': 'Floors 10-19',
  '20-29': 'Floors 20-29',
  '30-35': 'Floors 30-35',
  '36-38': 'Floors 36-38',
};

export const VIEW_LABELS: Record<string, string> = {
  harbour: 'Harbour',
  'harbour-partial': 'Harbour, partly blocked',
  park: 'Park',
  city: 'City',
  ridge: 'Ridge',
};

export const BEDROOM_LABELS: Record<string, string> = {
  '1': '1 bedroom',
  '2': '2 bedrooms',
  '3': '3 bedrooms',
};

export function chipLabel(field: string, value: string): string {
  switch (field) {
    case 'bedrooms': return BEDROOM_LABELS[value] ?? value;
    case 'band': return BAND_LABELS[value] ?? value;
    case 'view': return VIEW_LABELS[value] ?? value;
    case 'status': return STATUS_LABELS[value] ?? value;
    default: return value;
  }
}

// The lens chip and gridcell name (Interactions: Lens chip and gridcell name).
export function cellName(
  code: string,
  bearing: number,
  facing: string,
  statusLabel: string,
  syncing: boolean,
  dimmed: boolean,
): string {
  const parts = [`${code} · ${bearing}° ${facing} · ${statusLabel}`];
  if (syncing) parts.push('Syncing');
  if (dimmed) parts.push('Outside your filters');
  return parts.join(' · ');
}

export function basicCellName(code: string, statusLabel: string): string {
  return `${code} · ${statusLabel}`;
}
