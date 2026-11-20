// One place that talks to /api. Network failures become a known error shape.

export const OFFLINE = "Couldn't reach Tallow. Check your connection and try again.";

export class ApiFailure extends Error {
  constructor(status, body) {
    super(body?.message || OFFLINE);
    this.status = status;
    this.code = body?.error || "offline";
    this.errors = body?.errors || null;
    this.body = body || null;
  }
}

async function call(method, path, { body, headers } = {}) {
  const options = { method, headers: { ...(headers || {}) }, credentials: "same-origin" };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiFailure(0, null);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) throw new ApiFailure(response.status, payload);
  return payload;
}

export const api = {
  get: (path) => call("GET", path),
  post: (path, body, headers) => call("POST", path, { body: body ?? {}, headers }),
  patch: (path, body, headers) => call("PATCH", path, { body, headers }),
  remove: (path) => call("DELETE", path),
  async upload(path, file) {
    const form = new FormData();
    form.append("file", file);
    let response;
    try {
      response = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
    } catch {
      throw new ApiFailure(0, null);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiFailure(response.status, payload);
    return payload;
  },
};

export function newKey() {
  return crypto.randomUUID();
}

/** Open a signed download link under its published file name. */
export async function openDownload(path) {
  const { url } = await api.get(path);
  window.location.assign(url);
}
