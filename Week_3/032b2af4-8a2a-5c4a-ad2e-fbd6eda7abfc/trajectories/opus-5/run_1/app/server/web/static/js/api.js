const TOKEN_KEY = "pacely_token";
const COOKIE = "pacely_session";

function cookieValue(name) {
  const found = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export function token() {
  return localStorage.getItem(TOKEN_KEY) || cookieValue(COOKIE);
}

export function setToken(value) {
  localStorage.setItem(TOKEN_KEY, value);
  document.cookie = `${COOKIE}=${value}; path=/; max-age=2592000; samesite=lax`;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const session = token();
  if (session) headers.Authorization = `Bearer ${session}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

export function requireSession() {
  if (!token()) {
    window.location.replace("/login");
    return false;
  }
  return true;
}
