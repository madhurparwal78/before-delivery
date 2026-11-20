import { api } from './api.js';
import type { Member } from './types.js';

export interface AppConfig {
  toastSeconds: number;
  searchDebounceMs: number;
}

interface Listener { (): void }

export class Store {
  me: Member | null = null;
  config: AppConfig = { toastSeconds: 5, searchDebounceMs: 300 };
  serverNow: string = new Date().toISOString();
  #listeners = new Set<Listener>();
  #fetched = false;

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.#listeners) fn();
  }

  async ensureBootstrap(): Promise<void> {
    if (this.#fetched) return;
    this.#fetched = true;
    try {
      const cfg = await api<{ toast_seconds: number; search_debounce_ms: number; server_now: string }>('GET', '/api/config');
      this.config = { toastSeconds: cfg.toast_seconds, searchDebounceMs: cfg.search_debounce_ms };
      this.serverNow = cfg.server_now;
    } catch { /* config route may be absent; defaults hold */ }
    await this.refreshMe();
  }

  async refreshMe(): Promise<void> {
    try {
      this.me = await api<Member>('GET', '/api/me');
    } catch {
      this.me = null;
    }
    this.emit();
  }

  isFounder(): boolean { return this.me?.roles.includes('founder') ?? false; }
  isDriver(): boolean { return this.me?.roles.includes('driver') ?? false; }
}

export const store = new Store();
