/* API client with idempotency keys and retry-on-network-loss. */
"use strict";

function randomKey() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => String.fromCharCode(32 + (b % 94))).join("");
}

async function rawFetch(method, path, body, headers) {
  const init = { method, headers: Object.assign({}, headers), credentials: "same-origin" };
  if (body !== undefined && body !== null) init.body = body;
  const response = await fetch(path, init);
  return response;
}

async function readJson(response) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (err) { payload = {}; }
  return { status: response.status, headers: response.headers, body: payload };
}

class Api {
  constructor() {
    this.listeners = { offline: [], online: [] };
  }

  onOffline(fn) { this.listeners.offline.push(fn); }
  onOnline(fn) { this.listeners.online.push(fn); }

  async request(method, path, body, options = {}) {
    // Keyed actions retry up to 3 times within ~10s with the same idempotency key.
    const keyed = options.idempotency === "keyed";
    const key = keyed ? (options.key || randomKey()) : null;
    const attempts = keyed ? 4 : 1;
    let lastNetworkError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const headers = Object.assign({}, options.headers);
        if (keyed) headers["Idempotency-Key"] = key;
        const response = await rawFetch(method, path, body, headers);
        const result = await readJson(response);
        if (keyed && result.headers.get("Idempotent-Replayed") === "true") {
          result.replayed = true;
        }
        return result;
      } catch (err) {
        lastNetworkError = err;
        if (attempt < attempts - 1) {
          this.listeners.offline.forEach(fn => fn("retrying"));
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    this.listeners.offline.forEach(fn => fn("offline"));
    throw lastNetworkError;
  }

  json(method, path, payload, options = {}) {
    return this.request(method, path, payload === undefined ? undefined : JSON.stringify(payload),
      Object.assign({ headers: { "Content-Type": "application/json" } }, options));
  }

  get(path) { return this.request("GET", path); }

  signOut() { return this.request("DELETE", "/api/session"); }
  signIn(username, passcode) {
    return this.json("POST", "/api/session", { username, passcode });
  }
}
