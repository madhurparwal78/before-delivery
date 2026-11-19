/** What the open cockpit page knows about the signed-in company. Discarded with the page when the session ends. */
import { api } from "../shared/api.js";

interface Me {
  user: { id: string; email: string; name: string; role: "owner" | "admin" | "member"; company_id: string };
  company: { id: string; name: string };
  business_date: string;
  business_now: string;
  settlement_dates: Record<string, string>;
  settlement_dates_change_at: string;
}

export interface Account {
  id: string;
  name: string;
  kind: string;
  balance_cents: number;
  available_cents: number;
}

export const store = {
  me: null as Me | null,
  accounts: [] as Account[],
  waiting: 0,
};

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function on(topic: "accounts" | "waiting", listener: Listener): void {
  const set = listeners.get(topic) ?? new Set();
  set.add(listener);
  listeners.set(topic, set);
}

function emit(topic: string): void {
  for (const listener of listeners.get(topic) ?? []) listener();
}

export function currentMe(): Me {
  if (!store.me) throw new Error("session not loaded");
  return store.me;
}

export async function loadMe(): Promise<Me> {
  const { data } = await api<Me>("GET", "/api/me");
  store.me = data;
  return data;
}

export async function loadAccounts(): Promise<Account[]> {
  const { data } = await api<{ accounts: Account[] }>("GET", "/api/accounts");
  store.accounts = data.accounts;
  emit("accounts");
  return data.accounts;
}

export async function loadWaiting(): Promise<number> {
  const { data } = await api<{ approvals: unknown[] }>("GET", "/api/approvals");
  store.waiting = data.approvals.length;
  emit("waiting");
  return store.waiting;
}

export function setWaiting(count: number): void {
  store.waiting = count;
  emit("waiting");
}
