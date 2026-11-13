// JSON over fetch. Every call resolves to {ok, status, data, etag, headers}; nothing throws on an HTTP error.
// A 401 on a signed-in page sends the person to /sign-in.

const jsonHeaders = { 'Content-Type': 'application/json' };

export function newKey() {
  return crypto.randomUUID();
}

async function request(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) Object.assign(headers, jsonHeaders);
  if (opts.version !== undefined) headers['If-Match'] = `"${opts.version}"`;
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { ok: false, status: 0, data: { error: 'network' }, etag: null, headers: new Headers() };
  }
  let data = null;
  if (res.status !== 204 && res.status !== 304) {
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: 'unreadable' };
      }
    }
  }
  if (res.status === 401 && !opts.keepOn401 && location.pathname !== '/sign-in') {
    location.assign('/sign-in');
  }
  return { ok: res.ok, status: res.status, data, etag: res.headers.get('ETag'), headers: res.headers };
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body = {}, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

// fieldErrors turns a failed result into {field: sentence} (or null when the failure has no field errors).
export function fieldErrors(result) {
  return result && result.data && result.data.errors ? result.data.errors : null;
}
