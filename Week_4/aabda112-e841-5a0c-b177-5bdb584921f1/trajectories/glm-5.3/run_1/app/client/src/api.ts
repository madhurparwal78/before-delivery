// One small API client with pending-request tracking so a late answer for an
// older choice is dropped.

export type ApiError = { status: number; error: string; message: string; field?: string };

export class ApiRequestFailed extends Error {
  err: ApiError;
  constructor(err: ApiError) {
    super(err.message);
    this.err = err;
  }
}

export async function api(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; raw?: boolean; retryOnce?: boolean } = {}
): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const doFetch = () =>
    fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    if (opts.retryOnce) {
      // A request that ends with no response at all is resent once at once.
      res = await doFetch();
    } else {
      throw new ApiRequestFailed({ status: 0, error: 'network', message: 'network' });
    }
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiRequestFailed({
      status: res.status,
      error: data?.error ?? 'unknown',
      message: data?.message ?? 'Something went wrong.',
      field: data?.field,
    });
  }
  return data;
}

export const get = (path: string) => api('GET', path);
export const post = (path: string, body?: unknown, opts?: any) => api('POST', path, body, opts);
export const put = (path: string, body?: unknown) => api('PUT', path, body);
export const patch = (path: string, body?: unknown) => api('PATCH', path, body);
export const del = (path: string) => api('DELETE', path);

// clinic-time formatting from server instants; the browser clock decides nothing.
const dtf = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o });

const timeFmt = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = dtf({ weekday: 'short', day: '2-digit', month: 'short' });
const dateFmt = dtf({ day: '2-digit', month: 'short', year: 'numeric' });
const ymdFmt = dtf({ year: 'numeric', month: '2-digit', day: '2-digit' });

export const clinicTime = (iso: string): string => timeFmt.format(new Date(iso)).replace('24:', '00:');

export function clinicDate(iso: string): string {
  return ymdFmt.format(new Date(iso)).split('/').reverse().join('-');
}

export const clinicDayShort = (iso: string): string => dayFmt.format(new Date(iso)).slice(0, 3);
export const clinicDayMonth = (iso: string): string => dayFmt.format(new Date(iso)).slice(4);
export const clinicFullDate = (iso: string): string => dateFmt.format(new Date(iso));

export function money(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  return `${sign}£${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`;
}

export const ROLE_LABELS: Record<string, string> = {
  'front-desk': 'Front desk',
  nurse: 'Nurse',
  vet: 'Vet',
  manager: 'Manager',
};

export const SPECIES_LABELS: Record<string, string> = {
  dog: 'Dog',
  cat: 'Cat',
  rabbit: 'Rabbit',
  other: 'Other',
};

export const STATUS_LABELS: Record<string, string> = {
  'booked': 'Booked',
  'checked-in': 'Checked in',
  'in-consult': 'In consult',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'no-show': 'No-show',
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
