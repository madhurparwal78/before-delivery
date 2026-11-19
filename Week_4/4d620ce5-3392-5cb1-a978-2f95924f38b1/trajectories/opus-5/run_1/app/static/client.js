// Every request to the server, with the keyed retry rule.

import { RETRYING, SESSION_ENDED, STILL_OFFLINE } from "./copy.js";
import { announceError, announceStatus } from "./a11y.js";

const RETRIES = 3;
const RETRY_GAP = 3000;

let onSessionEnd = () => {};

export function whenSessionEnds(handler) {
  onSessionEnd = handler;
}

export function newKey() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
}

export class Offline extends Error {}

async function once(method, path, { body, contentType, key } = {}) {
  const headers = {};
  let payload;
  if (body !== undefined && body !== null) {
    if (body instanceof ArrayBuffer || body instanceof Blob || body instanceof Uint8Array) {
      payload = body;
      headers["Content-Type"] = contentType;
    } else {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }
  if (key) headers["Idempotency-Key"] = key;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
    });
  } catch (error) {
    throw new Offline(String(error));
  }
  const kind = response.headers.get("Content-Type") || "";
  let parsed = null;
  if (response.status !== 204) {
    if (kind.includes("application/json")) {
      parsed = await response.json().catch(() => null);
    } else {
      parsed = await response.arrayBuffer();
    }
  }
  if (response.status === 401 && path !== "/api/session") {
    onSessionEnd(SESSION_ENDED);
  }
  return {
    status: response.status,
    ok: response.status < 400,
    body: parsed,
    error: parsed && parsed.error ? parsed.error : null,
    replayed: response.headers.get("Idempotent-Replayed") === "true",
  };
}

/** A keyed request keeps the same key until it succeeds or the user presses again. */
export async function send(method, path, options = {}) {
  const attempts = options.key ? RETRIES + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await once(method, path, options);
    } catch (error) {
      if (!(error instanceof Offline) || attempt === attempts - 1) {
        if (options.key) announceError(STILL_OFFLINE);
        throw error;
      }
      announceStatus(RETRYING);
      await new Promise((resolve) => setTimeout(resolve, RETRY_GAP));
    }
  }
  throw new Offline("unreachable");
}

export const get = (path) => send("GET", path);
export const post = (path, body, options = {}) => send("POST", path, { ...options, body });
export const put = (path, body, options = {}) => send("PUT", path, { ...options, body });
export const del = (path) => send("DELETE", path);
