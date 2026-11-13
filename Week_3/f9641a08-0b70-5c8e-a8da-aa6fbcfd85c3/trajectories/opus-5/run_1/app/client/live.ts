import { announce, qs, qsa } from './core.js';

export type LiveHandler = (type: string, data: Record<string, unknown>) => void;

const handlers: LiveHandler[] = [];
let lastSeq: number | null = null;
let source: EventSource | null = null;

export function onLive(handler: LiveHandler): void {
  handlers.push(handler);
}

const TYPES = [
  'stock',
  'price',
  'collection',
  'order',
  'return',
  'trial',
  'warranty',
  'cart',
  'wishlist',
  'notification',
  'queue',
  'reset',
  'ready'
];

function connect(): void {
  const url = lastSeq === null ? '/api/live' : `/api/live?after=${lastSeq}`;
  source = new EventSource(url);

  source.addEventListener('open', () => {
    announce('connection', '');
  });

  for (const type of TYPES) {
    source.addEventListener(type, (event: MessageEvent<string>) => {
      if (event.lastEventId !== '') lastSeq = Number(event.lastEventId);
      if (type === 'ready') {
        const payload = JSON.parse(event.data) as { seq: number };
        if (lastSeq === null) lastSeq = payload.seq;
        announce('connection', '');
        return;
      }
      if (type === 'reset') {
        window.location.reload();
        return;
      }
      const data = JSON.parse(event.data) as Record<string, unknown>;
      for (const handler of handlers) handler(type, data);
    });
  }

  source.addEventListener('error', () => {
    announce('connection', 'Reconnecting to live updates.');
    source?.close();
    source = null;
    window.setTimeout(connect, 1000);
  });
}

export function startLive(): void {
  connect();
}

export function updateHeaderCounts(options: { cart?: number; wishlist?: number }): void {
  if (options.cart !== undefined) {
    const button = qs<HTMLElement>('[data-bag-open]');
    if (button !== null) {
      const label = `Bag, ${options.cart} ${options.cart === 1 ? 'item' : 'items'}`;
      button.setAttribute('aria-label', label);
      button.textContent = label;
    }
  }
  if (options.wishlist !== undefined) {
    const link = qs<HTMLElement>('[data-wishlist-link]');
    if (link !== null) {
      const label = `Wishlist, ${options.wishlist} ${options.wishlist === 1 ? 'item' : 'items'}`;
      link.setAttribute('aria-label', label);
      link.textContent = label;
    }
  }
}

export function applyStockEvent(sku: string, badge: string): void {
  for (const element of qsa<HTMLElement>(`[data-card-badge][data-sku="${sku}"]`)) {
    element.textContent = badge;
  }
}
