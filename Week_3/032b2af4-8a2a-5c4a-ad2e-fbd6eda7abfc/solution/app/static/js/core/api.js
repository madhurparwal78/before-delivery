const KEY = "pacely-token";

export const token = () => sessionStorage.getItem(KEY) || localStorage.getItem(KEY);

export function saveToken(value, remember) {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, value);
  document.documentElement.dataset.auth = "member";
}

export function clearToken() {
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
  document.documentElement.dataset.auth = "guest";
}

/** Calls the API with the session token; never throws: a network failure reads as status 0. */
export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token()) init.headers.Authorization = `Bearer ${token()}`;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

let meRequest = null;

/** The signed-in athlete, or null (a refused token is forgotten). */
export function currentAthlete() {
  if (!token()) return Promise.resolve(null);
  meRequest ??= api("/api/me").then((result) => {
    if (result.status === 401) clearToken();
    return result.ok ? result.data.athlete : null;
  });
  return meRequest;
}

export async function logOut() {
  await api("/api/auth/logout", { method: "POST" });
  clearToken();
  location.assign("/");
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A same-origin relative path or the fallback (port of the safe_redirect kit module). */
export function safeNext(target, fallback = "/dashboard") {
  if (typeof target !== "string" || target.length > 2048) return fallback;
  let text = target;
  for (let round = 0; round < 3; round++) {
    if (CONTROL.test(text) || text.includes("\\") || !text.startsWith("/") || text.startsWith("//")) return fallback;
    let decoded;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      return fallback;
    }
    if (decoded === text) return target;
    text = decoded;
  }
  return fallback;
}

/** The session's athlete for a signed-in page; a visitor is sent to the login page and then back. */
export async function requireMember() {
  const me = await currentAthlete();
  if (!me) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise(() => {});
  }
  return me;
}
