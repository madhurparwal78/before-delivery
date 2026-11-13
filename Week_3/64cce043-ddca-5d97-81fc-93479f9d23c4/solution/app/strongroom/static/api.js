// The one place the browser talks to /api. Answers come back as {status, body}; status 0 means no answer.

const listeners = new Set();

/** Called with every answered status, so the outage banner can re-check after any 503. */
export function onAnswer(listener) {
  listeners.add(listener);
}

export async function call(method, path, body, { key, signal, keepalive } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  let response;
  try {
    response = await fetch(path, {
      method, headers, signal, keepalive, credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { status: 0, body: null };
  }
  let parsed = null;
  if (response.status !== 204) {
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  }
  for (const listener of listeners) listener(response.status);
  return { status: response.status, body: parsed };
}

export const get = (path, options) => call('GET', path, undefined, options);

/** The holdings of a `GET /api/holdings` answer; `items` is the brief's published key for that list. */
export const listedHoldings = (listing) => listing.items;

/** Only the answer to the most recent request of a kind is ever handed back; older ones resolve to null. */
export class Latest {
  constructor() {
    this.seq = 0;
    this.controller = null;
  }

  async run(method, path, body) {
    this.seq += 1;
    const mine = this.seq;
    this.controller?.abort();
    this.controller = new AbortController();
    try {
      const answer = await call(method, path, body, { signal: this.controller.signal });
      return mine === this.seq ? answer : null;
    } catch {
      return null;
    }
  }

  cancel() {
    this.seq += 1;
    this.controller?.abort();
  }
}

export function errorMessage(answer) {
  return answer?.body?.error?.message;
}

export function errorCode(answer) {
  return answer?.body?.error?.code;
}

export const FAILED = 'Something went wrong. Your change was not saved.';

/** A request that failed without an error body: a network failure or a 500. */
export function failedWithoutBody(answer) {
  return answer.status === 0 || answer.status >= 500;
}
