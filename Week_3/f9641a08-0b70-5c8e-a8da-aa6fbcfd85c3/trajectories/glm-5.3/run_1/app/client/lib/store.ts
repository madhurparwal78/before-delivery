import { useEffect, useState } from 'preact/hooks';
import { api } from './api.js';

export type User = { id: number; name: string; email: string; role: string } | null;

export type Cart = {
  count: number;
  lines: { id: number; sku: string; product: string; colour: string; size: string; quantity: number; unit_price: number; line_subtotal: number; line_discount: number; available: number; badge: string }[];
  discount: { code: string; kind: string; value: number } | null;
  gift_card: { last4: string; balance: number } | null;
  shipping_method: string;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  notices: string[];
};

export type Wishlist = { count: number; items: { slug: string; name: string; saved_at: string }[] };

class Store {
  user: User = null;
  cart: Cart | null = null;
  wishlist: Wishlist = { count: 0, items: [] };
  connected = true;
  lastSeq = 0;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  async loadMe(): Promise<void> {
    try {
      const data = await api.get<{ user: User }>('/api/me');
      this.user = data.user;
    } catch {
      this.user = null;
    }
    this.emit();
  }

  async loadCart(): Promise<void> {
    try {
      this.cart = await api.get<Cart>('/api/cart');
      this.emit();
    } catch { /* keep the last known state */ }
  }

  async loadWishlist(): Promise<void> {
    try {
      this.wishlist = await api.get<Wishlist>('/api/wishlist');
      this.emit();
    } catch { /* keep the last known state */ }
  }

  async refreshAll(): Promise<void> {
    await Promise.all([this.loadMe(), this.loadCart(), this.loadWishlist()]);
  }
}

export const store = new Store();

export function useStore(): void {
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), []);
}

// --- live stream ---------------------------------------------------------------

type LiveHandler = (type: string, data: Record<string, unknown>) => void;
const handlers = new Set<LiveHandler>();

export function onLiveEvent(fn: LiveHandler): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

let source: EventSource | null = null;

export function startLiveStream(): void {
  if (source !== null) return;
  connect();
}

function connect(): void {
  const url = store.lastSeq > 0 ? `/api/live?after=${store.lastSeq}` : '/api/live';
  source = new EventSource(url);
  source.addEventListener('open', () => {
    store.connected = true;
    store.emit();
  });
  source.addEventListener('error', () => {
    store.connected = false;
    store.emit();
    source?.close();
    source = null;
    // The live stream reconnects by itself, resuming from the last sequence.
    setTimeout(() => { if (store.connected === false) connect(); }, 2000);
  });
  for (const type of ['stock', 'price', 'collection', 'order', 'return', 'trial', 'warranty', 'cart', 'wishlist', 'notification', 'queue', 'reset']) {
    source.addEventListener(type, (event) => {
      const id = (event as MessageEvent).lastEventId;
      if (id !== '') store.lastSeq = Math.max(store.lastSeq, Number(id));
      const data = JSON.parse((event as MessageEvent).data) as Record<string, unknown>;
      if (type === 'cart' && typeof data.count === 'number' && store.cart !== null) {
        store.cart = { ...store.cart, count: data.count as number };
        store.emit();
      }
      if (type === 'wishlist') {
        store.wishlist = { count: data.count as number, items: store.wishlist.items };
        store.emit();
      }
      for (const handler of handlers) handler(type, data);
    });
  }
}
