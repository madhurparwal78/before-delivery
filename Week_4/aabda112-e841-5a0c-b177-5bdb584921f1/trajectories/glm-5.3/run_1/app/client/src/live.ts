import { get, ApiRequestFailed } from './api.js';

// One live feed per window. The browser reconnects automatically and refetches
// state after a reconnect.

export type LiveHandler = (event: string, data: any) => void;

export class LiveFeed {
  private es: EventSource | null = null;
  private handlers: LiveHandler[] = [];
  private refetch: () => void = () => {};

  onEvent(handler: LiveHandler): void {
    this.handlers.push(handler);
  }

  setRefetch(fn: () => void): void {
    this.refetch = fn;
  }

  start(): void {
    const connect = () => {
      this.es = new EventSource('/api/live');
      this.es.onopen = () => {
        // after a reconnect, refetch all state
        this.refetch();
      };
      this.es.onerror = () => {
        // the browser retries automatically; nothing to do here
      };
      const names = [
        'appointments', 'queue', 'ward', 'beacons', 'note', 'stock', 'files',
        'patients', 'invoices', 'announcement', 'staff', 'role-changed',
        'access-removed', 'close', 'tick', 'hello',
      ];
      for (const name of names) {
        this.es.addEventListener(name, (ev: MessageEvent) => {
          let data: any = {};
          try {
            data = JSON.parse(ev.data);
          } catch {
            data = {};
          }
          for (const h of this.handlers) h(name, data);
        });
      }
    };
    connect();
  }
}

export const live = new LiveFeed();

// Announcements helper: the polite region appends one child per message.
export class Announcer {
  private el: HTMLElement | null = null;

  mount(): HTMLElement {
    if (this.el) return this.el;
    this.el = document.createElement('div');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-label', 'Announcements');
    this.el.classList.add('visually-hidden');
    document.body.appendChild(this.el);
    return this.el;
  }

  say(text: string): void {
    const el = this.mount();
    const child = document.createElement('p');
    child.textContent = text;
    el.appendChild(child);
  }
}

export const announcer = new Announcer();

export async function ensureSession(): Promise<any | null> {
  try {
    return await get('/api/me');
  } catch (e) {
    if (e instanceof ApiRequestFailed && e.err.status === 401) return null;
    return null;
  }
}
