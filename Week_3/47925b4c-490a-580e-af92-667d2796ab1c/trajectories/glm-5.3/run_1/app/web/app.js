// The app shell: API client, offline reading queue, live updates and views.

export const BAND = { washedOut: 'Washed out', graphics: 'Reads as graphics', image: 'Reads as image', none: 'No reading' };

const QUEUE_KEY = 'gevelwerk.reading-queue.v1';

// ---------- problem details ----------
export class ApiProblem extends Error {
  constructor(problem) {
    super(problem.detail);
    this.problem = problem;
  }
  get code() { return this.problem.code; }
  get detail() { return this.problem.detail; }
  get errors() { return this.problem.errors ?? null; }
}

async function request(method, path, body, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (navigator.onLine) {
    // nothing extra
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...options.fetch,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    if (json && json.code) throw new ApiProblem(json);
    throw new ApiProblem({ code: 'internal_error', detail: 'Something went wrong on our side.', status: response.status });
  }
  return json;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  patch: (path, body, options) => request('PATCH', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  delete: (path, options) => request('DELETE', path, undefined, options),
  raw: async (method, path, body, headers) => {
    const response = await fetch(path, { method, headers, body });
    if (!response.ok) {
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      throw new ApiProblem(json ?? { code: 'internal_error', detail: 'Something went wrong on our side.' });
    }
    return response;
  },
};

// ---------- idempotency keys ----------
const keyStore = new Map();

export function idempotencyKey(scope, seed) {
  const composite = `${scope}|${seed}`;
  let key = keyStore.get(composite);
  if (!key) {
    key = `${scope}-${crypto.randomUUID()}`;
    keyStore.set(composite, key);
  }
  return key;
}

// ---------- offline reading queue ----------
export function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueue(operations) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(operations));
}

export function enqueueReading(operation) {
  const queue = loadQueue();
  queue.push({ ...operation, localId: crypto.randomUUID() });
  saveQueue(queue);
  return queue.length;
}

export function removeFromQueue(localId) {
  const queue = loadQueue().filter((op) => op.localId !== localId);
  saveQueue(queue);
  return queue;
}

export function replaceQueue(operations) {
  saveQueue(operations);
  return operations;
}

// The queue drains itself when signal returns and on demand.
export async function syncQueue(siteId, onProgress) {
  const queue = loadQueue();
  const needsFixing = queue.filter((op) => op.rejected);
  const pending = queue.filter((op) => !op.rejected && !op.result);
  if (pending.length === 0) return { waiting: 0, needsFixing: needsFixing.length };
  const batches = [];
  for (let i = 0; i < pending.length; i += 100) batches.push(pending.slice(i, i + 100));
  let remaining = [...pending];
  for (const batch of batches) {
    const operations = batch.map((op) => ({ operationId: op.operationId, cell: op.cell, value: op.value, capturedAt: op.capturedAt }));
    try {
      const response = await api.post(`/api/sites/${siteId}/readings/sync`, { operations });
      const byId = new Map(response.results.map((r) => [r.operationId, r]));
      remaining = remaining.filter((op) => {
        const result = byId.get(op.operationId);
        if (!result) return true;
        if (result.status === 'applied' || result.status === 'duplicate') return false;
        op.rejected = true;
        op.errors = result.errors ?? {};
        op.code = result.code;
        return true;
      });
    } catch {
      break; // offline; try again later
    }
    onProgress?.();
  }
  replaceQueue(remaining);
  return { waiting: remaining.filter((op) => !op.rejected).length, needsFixing: remaining.filter((op) => op.rejected).length };
}

// ---------- live updates ----------
const source = { hub: null, listeners: new Set(), lastEventId: null };

export function subscribe(handler) {
  source.listeners.add(handler);
  if (source.hub === null) connectStream();
  return () => source.listeners.delete(handler);
}

function connectStream() {
  const hub = new EventSource('/api/events');
  hub.onmessage = (event) => {
    source.lastEventId = event.lastEventId;
    let data = null;
    try { data = JSON.parse(event.data); } catch { return; }
    for (const listener of source.listeners) listener(data);
  };
  hub.onerror = () => {
    // Screens reconnect by themselves; the browser retries with Last-Event-ID
  };
  source.hub = hub;
}

// ---------- helpers ----------
export function formatCents(cents) {
  const sign = cents < 0 ? '€ -' : '€ ';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function formatMmSS(seconds) {
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function cellCentre(column, row) {
  return { across: (column - 0.5) * 0.5, down: (row - 0.5) * 0.5 };
}

export function parseCellName(name) {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(name);
  if (!match) return null;
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { column, row: Number(match[2]) };
}

export function cellNameOf(column, row) {
  let n = column;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters + row;
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
