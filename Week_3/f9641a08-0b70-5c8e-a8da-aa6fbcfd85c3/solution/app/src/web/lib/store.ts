import { useSyncExternalStore } from "react";
import type { Cart, Config, User, Wishlist } from "../../shared/api";
import { api } from "./api";

// App-wide state read by the header, the live regions and the toasts. Pages keep their own data.

interface Announcement {
  id: number;
  text: string;
  undo: { sku: string; quantity: number; product: string } | null;
}

interface AppState {
  ready: boolean;
  config: Config | null;
  me: User | null;
  cart: Cart | null;
  wishlistSlugs: string[];
  wishlistCount: number;
  connected: boolean;
  announcement: Announcement | null;
  compareStatus: Announcement | null;
  /** The last comparison set seen in this tab, carried by the header link. */
  compareSet: string;
}

let state: AppState = {
  ready: false,
  config: null,
  me: null,
  cart: null,
  wishlistSlugs: [],
  wishlistCount: 0,
  connected: true,
  announcement: null,
  compareStatus: null,
  compareSet: window.sessionStorage.getItem("compare") ?? "",
};

const listeners = new Set<() => void>();
let counter = 0;

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}


export function useApp(): AppState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Announces into `status "Cart updates"` and the toast that mirrors it. */
export function announce(text: string, undo: Announcement["undo"] = null): void {
  counter += 1;
  setState({ announcement: { id: counter, text, undo } });
}

/** Announces into `status "Compare updates"` on the compare page and, as a cart update, elsewhere. */
export function announceCompare(text: string): void {
  counter += 1;
  setState({ compareStatus: { id: counter, text, undo: null } });
  announce(text);
}

export function rememberCompare(set: string): void {
  window.sessionStorage.setItem("compare", set);
  setState({ compareSet: set });
}

export async function refreshCart(): Promise<Cart> {
  const cart = await api.get<Cart>("/api/cart");
  setState({ cart });
  return cart;
}

export function applyCart(cart: Cart): void {
  setState({ cart });
}

export function applyWishlist(wishlist: { count: number; slugs?: string[]; items?: Wishlist["items"] }): void {
  setState({
    wishlistCount: wishlist.count,
    wishlistSlugs: wishlist.slugs ?? wishlist.items?.map((i) => i.slug) ?? state.wishlistSlugs,
  });
}

export async function refreshMe(): Promise<User | null> {
  const { user } = await api.get<{ user: User | null }>("/api/me");
  setState({ me: user });
  return user;
}

export async function refreshWishlist(): Promise<void> {
  applyWishlist(await api.get<Wishlist>("/api/wishlist"));
}

/** Loads config, the signed-in user, the bag and the wishlist once per page load. */
export async function boot(): Promise<void> {
  const [config, me, cart, wishlist] = await Promise.all([
    api.get<Config>("/api/config"),
    api.get<{ user: User | null }>("/api/me"),
    api.get<Cart>("/api/cart"),
    api.get<Wishlist>("/api/wishlist"),
  ]);
  setState({ config, me: me.user, cart, ready: true });
  applyWishlist(wishlist);
}

export function useConfig(): Config {
  const { config } = useApp();
  if (!config) throw new Error("config is loaded before the app renders");
  return config;
}
