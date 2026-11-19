// The one way the pages talk to the API. An authenticated request without a
// stored token is never sent, so nothing from a signed-out session acts again.

import * as session from './session.js';

let revokedHandler = () => {};

export function setRevokedHandler(handler) {
  revokedHandler = handler;
}

export const OUTAGE_MESSAGE = "Tallwind can't be reached right now. Try again in a moment.";
export const RECOVERY_MESSAGE = 'Tallwind is back online.';
export const SERVER_ERROR_MESSAGE = 'Something went wrong. Try again.';

export async function request(method, path, options = {}) {
  const { body, idempotencyKey, authenticated = true, raw = false } = options;
  const headers = {};
  if (authenticated) {
    const bearer = session.token();
    if (!bearer) return { aborted: true, status: 0, json: null };
    headers.Authorization = `Bearer ${bearer}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, json: null, offline: true };
  }

  if (response.status === 401 && authenticated) {
    revokedHandler();
    return { status: 401, json: { error: 'unauthorized' }, revoked: true };
  }

  if (raw) {
    const blob = await response.blob();
    return { status: response.status, blob, headers: response.headers, json: null };
  }

  let json = null;
  const text = await response.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (error) {
      json = null;
    }
  }
  return { status: response.status, json, headers: response.headers };
}

export const get = (path, options) => request('GET', path, options);
export const post = (path, body, options) => request('POST', path, { ...options, body });
export const del = (path, options) => request('DELETE', path, options);

export function isOutage(answer) {
  return answer.offline === true || answer.status === 503;
}

export function fieldErrors(answer) {
  if (answer.json && answer.json.error === 'validation' && answer.json.fields) return answer.json.fields;
  return null;
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
