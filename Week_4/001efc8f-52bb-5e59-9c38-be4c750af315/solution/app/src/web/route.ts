import { useSyncExternalStore } from "react";

// Shell addresses: /c/<channel_id> plus at most one of ?q, ?thread or ?photo; / and /join/<token>.
type Address =
  | { screen: "join"; token: string }
  | { screen: "root" }
  | { screen: "channel"; channelId: string; q: string | null; thread: string | null; photo: string | null };

const CHANGE = "rimewire:navigate";

function parseAddress(pathname: string, search: string): Address {
  const join = /^\/join\/([^/]+)$/.exec(pathname);
  if (join?.[1]) return { screen: "join", token: decodeURIComponent(join[1]) };
  const channel = /^\/c\/([^/]+)$/.exec(pathname);
  if (!channel?.[1]) return { screen: "root" };
  const params = new URLSearchParams(search);
  const q = params.get("q");
  const thread = q === null ? params.get("thread") : null;
  const photo = q === null && thread === null ? params.get("photo") : null;
  return { screen: "channel", channelId: decodeURIComponent(channel[1]), q, thread, photo };
}

export function channelPath(channelId: string, param?: { q?: string; thread?: string; photo?: string }): string {
  const base = `/c/${encodeURIComponent(channelId)}`;
  if (!param) return base;
  const [key, value] = Object.entries(param).find(([, v]) => v !== undefined) ?? [];
  return key && value !== undefined ? `${base}?${new URLSearchParams({ [key]: value }).toString()}` : base;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(CHANGE));
}

// Drops the address's panel parameter (Close details, Close, Escape).
export function dropParameter(): void {
  navigate(location.pathname, { replace: true });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

const snapshot = () => location.pathname + location.search;

export function useAddress(): Address {
  const href = useSyncExternalStore(subscribe, snapshot);
  const at = href.indexOf("?");
  return parseAddress(at === -1 ? href : href.slice(0, at), at === -1 ? "" : href.slice(at));
}
