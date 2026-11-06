/** The one place the browser talks to the server. */

export const BACKGROUND = { 'X-Wardline-Background': '1' };

export async function call(method, path, options = {}) {
  const headers = {};
  if (options.background) Object.assign(headers, BACKGROUND);
  if (options.proof) headers['X-Step-Up-Proof'] = options.proof;
  let payload;
  if (options.raw !== undefined) {
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  let reply;
  try {
    reply = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch (error) {
    return { status: 0, body: null, offline: true };
  }
  let body = null;
  const kind = reply.headers.get('content-type') || '';
  if (options.blob) {
    body = reply.ok ? await reply.blob() : await safeJson(reply);
  } else if (kind.includes('application/json')) {
    body = await safeJson(reply);
  }
  const result = {
    status: reply.status,
    body,
    headers: reply.headers,
    ok: reply.ok,
  };
  if (reply.status === 401 && body && body.error === 'unauthenticated') {
    window.dispatchEvent(new CustomEvent('wardline:unauthenticated'));
  }
  return result;
}

async function safeJson(reply) {
  try {
    return await reply.json();
  } catch (error) {
    return null;
  }
}

export function get(path, options = {}) {
  return call('GET', path, options);
}

export function post(path, body, options = {}) {
  return call('POST', path, { body: body === undefined ? {} : body, ...options });
}

export function put(path, body, options = {}) {
  return call('PUT', path, { body, ...options });
}

export function patch(path, body, options = {}) {
  return call('PATCH', path, { body, ...options });
}

export function remove(path, options = {}) {
  return call('DELETE', path, options);
}

export async function stepUpProof(password, code) {
  return post('/api/step-up', { password, code });
}

/** Asks for a grant, claims it and hands back the bytes. */
export async function claim(grantPath, body = {}) {
  const grant = await post(grantPath, body);
  if (grant.status !== 201) return { grant, blob: null };
  const file = await get(`/api/download/${grant.body.token}`, { blob: true });
  return { grant, file };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function blobDigest(blob) {
  if (!window.crypto || !window.crypto.subtle) return null;
  const bytes = await blob.arrayBuffer();
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
