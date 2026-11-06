import { get } from './api.js';
import type { Cart, Catalog, Me } from './types.js';

let cart: Cart | null = null;
let me: Me | null | undefined;
let catalog: Catalog | null = null;
const cartListeners = new Set<(value: Cart) => void>();

export async function loadCatalog(): Promise<Catalog> {
  if (!catalog) {
    const result = await get<Catalog>('/api/catalog');
    catalog = result.body;
  }
  return catalog;
}

export async function loadMe(): Promise<Me | null> {
  if (me === undefined) {
    const result = await get<Me>('/api/me');
    me = result.ok ? result.body : null;
  }
  return me;
}

export function clearMe(): void {
  me = undefined;
}

export async function loadCart(force = false): Promise<Cart> {
  if (!cart || force) {
    const result = await get<Cart>('/api/cart');
    cart = result.body;
    for (const listener of cartListeners) listener(cart);
  }
  return cart;
}

export function setCart(value: Cart): void {
  cart = value;
  for (const listener of cartListeners) listener(value);
}

export function cachedCart(): Cart | null {
  return cart;
}

export function onCartChange(listener: (value: Cart) => void): () => void {
  cartListeners.add(listener);
  return () => cartListeners.delete(listener);
}
