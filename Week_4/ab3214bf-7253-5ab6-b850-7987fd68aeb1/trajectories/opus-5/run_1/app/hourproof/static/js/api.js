// Every call to the server, the settlement clock it carries, and the 401 contract.

const listeners = new Set();
let serverNowMs = null;
let serverNowAt = null;
let pausedForSignIn = false;
let signInHandler = null;

export function onServerTime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serverTime() {
  if (serverNowMs === null) return new Date();
  return new Date(serverNowMs + (performance.now() - serverNowAt));
}

export function hasServerTime() {
  return serverNowMs !== null;
}

function takeServerNow(body) {
  if (!body || typeof body.server_now !== 'string') return;
  serverNowMs = Date.parse(body.server_now);
  serverNowAt = performance.now();
  listeners.forEach((listener) => listener(serverTime()));
}

export function setSignInHandler(handler) {
  signInHandler = handler;
}

export function refreshingPaused() {
  return pausedForSignIn;
}

async function fetchOnce(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await response.json();
  takeServerNow(data);
  return {
    status: response.status,
    data,
    ok: response.ok,
    error: data && data.error ? data.error : null,
  };
}

export function raw(method, path, body) {
  return fetchOnce(method, path, body);
}

export async function request(method, path, body) {
  const first = await fetchOnce(method, path, body);
  if (first.status !== 401 || !signInHandler) return first;
  pausedForSignIn = true;
  const resumed = await signInHandler();
  pausedForSignIn = false;
  if (!resumed) return { ...first, cancelled: true };
  return fetchOnce(method, path, body);
}

export const get = (path) => request('GET', path);
export const post = (path, body = {}) => request('POST', path, body);
export const put = (path, body = {}) => request('PUT', path, body);
