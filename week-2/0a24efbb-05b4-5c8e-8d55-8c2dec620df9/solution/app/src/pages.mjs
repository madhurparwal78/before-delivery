import { health } from "./boot.mjs";
import { resolveSession, presentedToken } from "./sessions.mjs";

// Which paths are pages, who reaches them signed out, and where a sign-in may return to.

const SHARED = /^\/share\/[^/]+$/;
const ROUTE_TABLE = [/^\/$/, /^\/login$/, /^\/requests$/, /^\/requests\/new$/, /^\/requests\/[^/]+$/, /^\/calendar$/, /^\/policy$/,
  SHARED];

export function inRouteTable(path) {
  return ROUTE_TABLE.some((route) => route.test(path)) && !path.endsWith(".data");
}

/** The safe-`next` test: one leading slash, no backslash, control character or scheme, and a desk route. */
export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/") || next[1] === "/" || next[1] === "\\") return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next) || /^[a-z][a-z0-9+.-]*:|:\/\//i.test(next.slice(1))) return null;
  const path = next.split(/[?#]/)[0];
  return path !== "/login" && !SHARED.test(path) && inRouteTable(path) ? next : null;
}

/** A path and query as a header value: anything outside printable ASCII percent-encoded. */
const asLocation = (target) => target.replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c));

/**
 * Decide a page request before React Router draws it: redirects for `/`, `/login` and signed-out visitors, and the
 * session the page is drawn for. A shared month is drawn bare, with no session read, renewed or ended.
 * Answers `{redirect}` or `{render: {path, context}}`.
 */
export async function routePage(url, headers) {
  const [path, query = ""] = url.split(/\?(.*)/s);
  if (SHARED.test(path)) return { render: { path, context: { caller: null, bare: true } } };
  const session = await resolveSession(presentedToken(headers));
  if (!inRouteTable(path)) return { render: { path: "/not-found", context: { caller: session.caller ?? null } } };
  if (path === "/") return { redirect: session.caller ? "/requests" : "/login" };
  if (path === "/login") {
    const next = safeNext(new URLSearchParams(query).get("next"));
    if (session.caller) return { redirect: asLocation(next ?? "/requests") };
    return {
      render: {
        path: url,
        context: { caller: null, login: { next, ended: Boolean(session.ended), realm: (await health()).realm } },
      },
    };
  }
  if (!session.caller) return { redirect: `/login?next=${encodeURIComponent(url)}` };
  return { render: { path: url, context: { caller: session.caller } } };
}
