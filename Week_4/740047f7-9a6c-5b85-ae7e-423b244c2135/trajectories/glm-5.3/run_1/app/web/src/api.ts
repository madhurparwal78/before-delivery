// The browser's API client. Every call goes to the app's own origin,
// carries the device header, and surfaces the one error shape.

export const DEVICES = [
  { id: 'DEV-1', name: 'Topside laptop' },
  { id: 'DEV-2', name: 'Deck tablet' },
];

export function deviceId(): string {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('device');
  if (fromQuery === 'DEV-1' || fromQuery === 'DEV-2') {
    try { localStorage.setItem('pensight-device', fromQuery); } catch {}
    url.searchParams.delete('device');
    history.replaceState(null, '', url.pathname + (url.searchParams.size ? '?' + url.searchParams.toString() : '') + url.hash);
    return fromQuery;
  }
  try {
    const stored = localStorage.getItem('pensight-device');
    if (stored === 'DEV-1' || stored === 'DEV-2') return stored;
  } catch {}
  return 'DEV-1';
}

export function deviceName(): string {
  return DEVICES.find(d => d.id === deviceId())?.name ?? 'Topside laptop';
}

export function otherDeviceId(): string {
  return deviceId() === 'DEV-1' ? 'DEV-2' : 'DEV-1';
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  body: unknown;
  constructor(status: number, body: unknown) {
    const b = body as { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } };
    super(b?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = b?.error?.code ?? 'unknown';
    this.fields = b?.error?.fields;
    this.details = b?.error?.details;
    this.body = body;
  }
}

export class NetworkError extends Error {
  constructor() { super('Pensight server unreachable — changes are not saved'); }
}

export type Pending = { inFlight: boolean };

async function request<T>(method: string, path: string, body?: unknown, opts?: { raw?: Blob; fileName?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !opts?.raw) headers['Content-Type'] = 'application/json';
  if (!path.startsWith('/api/share/')) headers['X-Pensight-Device'] = deviceId();
  if (opts?.fileName) headers['X-Filename'] = opts.fileName;
  let payload: BodyInit | undefined;
  if (opts?.raw) payload = opts.raw;
  else if (body !== undefined) payload = JSON.stringify(body);
  let resp: Response;
  try {
    resp = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new NetworkError();
  }
  const ct = resp.headers.get('content-type') ?? '';
  if (ct.includes('json')) {
    const data = await resp.json();
    if (!resp.ok) throw new ApiError(resp.status, data);
    return data as T;
  }
  if (!resp.ok) throw new ApiError(resp.status, {});
  return (await resp.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, blob: Blob, fileName?: string) =>
    request<T>('POST', path, undefined, { raw: blob, fileName }),
};
