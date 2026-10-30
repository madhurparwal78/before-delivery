// Session, cart count and the polite Announcements region shared by every page.
import { api } from "./api.ts";
import type { FinancingTerm } from "./catalog.ts";

export interface User {
  id: number;
  email: string;
  role: "customer" | "admin" | "dealer" | "support";
}

export interface CartLine {
  id: number;
  type: "build" | "accessory";
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

export interface Cart {
  lines: CartLine[];
  accessory_subtotal_cents: number;
  build_subtotal_cents: number;
  subtotal_cents: number;
  codes: { code: string; amount_cents: number }[];
  item_count: number;
  financing: FinancingTerm[];
}

let current: Promise<User | null> | null = null;
const cartListeners: ((count: number) => void)[] = [];
const userListeners: ((user: User | null) => void)[] = [];

export function session(): Promise<User | null> {
  current ??= (async () => {
    const r = await api<{ user: User }>("GET", "/api/me");
    return r.ok ? r.data.user : null;
  })();
  return current;
}

export function setSession(user: User | null): void {
  current = Promise.resolve(user);
  for (const listener of userListeners) listener(user);
}

export function onSession(listener: (user: User | null) => void): void {
  userListeners.push(listener);
}

export function onCartCount(listener: (count: number) => void): void {
  cartListeners.push(listener);
}

export function setCartCount(count: number): void {
  for (const listener of cartListeners) listener(count);
}

export async function refreshCart(): Promise<Cart | null> {
  const r = await api<Cart>("GET", "/api/cart");
  if (r.ok) setCartCount(r.data.item_count);
  return r.ok ? r.data : null;
}

let region: HTMLElement | null = null;

export function setAnnouncer(el: HTMLElement): void {
  region = el;
}

/** Writes polite copy into the Announcements status region; repeating a message still re-announces it. */
export function announce(text: string): void {
  if (!region) return;
  region.textContent = region.textContent === text ? `${text} ` : text;
}
