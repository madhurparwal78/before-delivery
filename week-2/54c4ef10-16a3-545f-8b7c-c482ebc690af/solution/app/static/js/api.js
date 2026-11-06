// Same-origin JSON calls. A 401 sends the browser to sign-in; a storage 503 re-checks the outage banner.
import { hooks } from './hooks.js';

export class NetworkLost extends Error {}

export async function api(method, path, body, { keep401 = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkLost(error.message);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 401 && !keep401) {
    hooks.unauthenticated();
    return new Promise(() => {});
  }
  if (response.status === 503 && data?.error === 'storage_unavailable') hooks.storageRefused();
  return { status: response.status, ok: response.ok, data };
}

export const get = (path, options) => api('GET', path, undefined, options);
export const post = (path, body = {}, options) => api('POST', path, body, options);
export const patch = (path, body, options) => api('PATCH', path, body, options);
export const put = (path, body, options) => api('PUT', path, body, options);
export const del = (path, options) => api('DELETE', path, undefined, options);
