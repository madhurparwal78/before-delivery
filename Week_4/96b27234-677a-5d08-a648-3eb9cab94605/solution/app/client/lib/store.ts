import { useSyncExternalStore } from "react";
import type { Rank } from "../../shared/protocol";
import { call } from "./api";

type Listener = () => void;

/** A tiny external store: components subscribe with `useStore`. */
class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private value: T) {}
  get = (): T => this.value;
  set = (next: T): void => {
    this.value = next;
    this.listeners.forEach((listener) => listener());
  };
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get);

interface Me {
  personId: string;
  displayName: string;
  email: string;
  siteRole: "member" | "moderator";
  timeZone: string;
  avatarId: string | null;
  hideAbove: Rank | null;
  worldId: string;
}

type Account = { state: "loading" } | { state: "out" } | { state: "in"; me: Me };

export const account = new Store<Account>({ state: "loading" });

export async function loadAccount(): Promise<void> {
  const reply = await call<Me>("GET", "/api/me");
  account.set(reply.ok ? { state: "in", me: reply.data } : { state: "out" });
}

export function patchMe(change: Partial<Me>): void {
  const current = account.get();
  if (current.state === "in") account.set({ state: "in", me: { ...current.me, ...change } });
}

// Notices in `alert`: removal, suspension, warning and outage texts. They stay until the person moves on.
interface Notice {
  key: string;
  text: string;
}

export const notices = new Store<Notice[]>([]);

export function showNotice(text: string, key = text): void {
  const current = notices.get();
  if (!current.some((notice) => notice.key === key)) notices.set([...current, { key, text }]);
}

export function clearNotice(key: string): void {
  notices.set(notices.get().filter((notice) => notice.key !== key));
}

export const clearNotices = (): void => notices.set([]);

/** Counters bumped by pushed events so pages reload what the event changed. */
export const pushed = new Store({ friends: 0, role: 0 });
