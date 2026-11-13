// Client routes over the History API.
import { Store } from "./store.js";

export type Route =
  | { page: "signup" }
  | { page: "signin" }
  | { page: "forgot" }
  | { page: "reset"; token: string }
  | { page: "verify"; token: string }
  | { page: "home" }
  | { page: "profile"; handle: string }
  | { page: "match"; matchId: number }
  | { page: "replay"; matchId: number; round: number; tick: number | null };

function parseRoute(location: Location): Route {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(location.search);
  const token = search.get("token") ?? "";
  if (path === "/signup") return { page: "signup" };
  if (path === "/signin") return { page: "signin" };
  if (path === "/forgot-password") return { page: "forgot" };
  if (path === "/reset-password") return { page: "reset", token };
  if (path === "/verify") return { page: "verify", token };
  const profile = /^\/u\/([^/]+)$/.exec(path);
  if (profile?.[1] !== undefined) return { page: "profile", handle: decodeURIComponent(profile[1]).toLowerCase() };
  const replay = /^\/matches\/(\d+)\/rounds\/(\d+)$/.exec(path);
  if (replay?.[1] !== undefined && replay[2] !== undefined) {
    const tick = search.get("tick");
    return { page: "replay", matchId: Number(replay[1]), round: Number(replay[2]), tick: tick !== null && /^\d+$/.test(tick) ? Number(tick) : null };
  }
  const match = /^\/matches\/(\d+)$/.exec(path);
  if (match?.[1] !== undefined) return { page: "match", matchId: Number(match[1]) };
  return { page: "home" };
}

export const route = new Store<Route>(parseRoute(window.location));

export function navigate(url: string): void {
  window.history.pushState(null, "", url);
  route.set(parseRoute(window.location));
}

export function redirect(url: string): void {
  window.history.replaceState(null, "", url);
  route.set(parseRoute(window.location));
}

window.addEventListener("popstate", () => route.set(parseRoute(window.location)));

// Keeps in-app links inside the single-page app.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  if (anchor === null || anchor.target !== "" || anchor.origin !== window.location.origin) return;
  event.preventDefault();
  navigate(anchor.pathname + anchor.search);
});
