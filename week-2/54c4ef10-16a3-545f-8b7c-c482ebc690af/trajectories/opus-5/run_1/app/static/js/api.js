// Same-origin API calls. Every response is read as the published error shape.
import { sha256Hex } from './sha256.js';

export class ApiFailure extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `status ${status}`);
    this.status = status;
    this.body = body || {};
    this.code = this.body.error;
    this.fields = this.body.fields || {};
  }
}

const listeners = { unauthenticated: [], storage: [] };

export function on(event, handler) {
  listeners[event].push(handler);
}

function announceStorage(down) {
  for (const handler of listeners.storage) handler(down);
}

export async function call(method, path, body, options = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (response.ok) return payload;
  if (response.status === 401 && !options.keepSession) {
    for (const handler of listeners.unauthenticated) handler();
  }
  if (response.status === 503 && payload && payload.error === 'storage_unavailable') {
    announceStorage(true);
  }
  throw new ApiFailure(response.status, payload);
}

export const get = (path) => call('GET', path);
export const post = (path, body) => call('POST', path, body === undefined ? {} : body);
export const patch = (path, body) => call('PATCH', path, body);
export const put = (path, body) => call('PUT', path, body);
export const remove = (path) => call('DELETE', path);

export async function storageState() {
  try {
    const body = await call('GET', '/api/storage');
    const down = body.storage !== 'ok';
    announceStorage(down);
    return !down;
  } catch {
    announceStorage(true);
    return false;
  }
}

// Uploads report the bytes actually sent, so they go through XHR.
export function uploadStrip({ rollId, file, dpi, firstEdge, size, sha256, onProgress }) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      dpi: String(dpi),
      first_edge: String(firstEdge),
      filename: file.name,
    });
    const request = new XMLHttpRequest();
    request.open('POST', `/api/rolls/${rollId}/scans?${query.toString()}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-Scan-Size', String(size));
    request.setRequestHeader('X-Scan-SHA256', sha256);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.floor((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let payload = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }
      if (request.status === 401) {
        for (const handler of listeners.unauthenticated) handler();
      }
      if (request.status === 503) announceStorage(true);
      reject(new ApiFailure(request.status, payload));
    });
    request.addEventListener('error', () => reject(new ApiFailure(0, null)));
    request.addEventListener('abort', () => reject(new ApiFailure(0, null)));
    request.send(file);
  });
}

export async function fileDigest(file) {
  const buffer = await file.arrayBuffer();
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256Hex(new Uint8Array(buffer));
}
