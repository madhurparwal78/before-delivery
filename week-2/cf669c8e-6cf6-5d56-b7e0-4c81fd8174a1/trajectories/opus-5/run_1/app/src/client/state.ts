/**
 * Shared browser state: the signed-in user, the catalogue, provider status and
 * the live test-ride hold.
 *
 * All open, due, expired, late and countdown values come from the server. The
 * browser renders them and never recomputes them from its own clock.
 */

import { ApiCallError, NetworkError, api, type Catalogue } from './api.js';
import type { ProviderStatus, Ride, User } from '../shared/types.js';

const STATUS_INTERVAL_MS = 3_000;

export interface SessionEndedRequest {
  /** The control the rider pressed, which focus returns to. */
  opener: HTMLElement | null;
  /** Run again after a fresh sign-in, on a new press for money actions. */
  retry: (() => void) | null;
  /** A plan save is retried once automatically. */
  retryAutomatically: boolean;
}

type Listener = () => void;

class Store {
  user: User | null = null;
  catalogue: Catalogue | null = null;
  status: ProviderStatus = { killbill: 'up', registry: 'up', serverNow: new Date().toISOString() };
  hold: Ride | null = null;
  /** The configurator address to resume, remembered by this browser tab. */
  resumeConfiguration: string | null = null;

  private readonly listeners = new Set<Listener>();
  private readonly sessionListeners = new Set<(request: SessionEndedRequest) => void>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onSessionEnded(listener: (request: SessionEndedRequest) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  announce(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * The next action answering 401 opens the sign-in dialog over the page, with
   * the address unchanged and every typed value kept.
   */
  sessionEnded(request: SessionEndedRequest): void {
    for (const listener of this.sessionListeners) listener(request);
  }

  async loadUser(): Promise<void> {
    try {
      this.user = await api.me();
    } catch {
      this.user = null;
    }
    this.announce();
  }

  async loadCatalogue(): Promise<Catalogue> {
    this.catalogue ??= await api.catalogue();
    return this.catalogue;
  }

  async refreshStatus(): Promise<void> {
    try {
      const next = await api.status();
      const changed =
        next.killbill !== this.status.killbill || next.registry !== this.status.registry;
      this.status = next;
      if (changed) this.announce();
    } catch (error) {
      if (error instanceof NetworkError) return;
      throw error;
    }
  }

  /** The rider's live hold, which the header counts down. */
  async refreshHold(): Promise<void> {
    if (!this.user || this.user.role !== 'rider') {
      this.hold = null;
      return;
    }
    try {
      const { rides } = await api.rides();
      this.hold = rides.find((ride) => ride.state === 'held') ?? null;
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 401) return;
      if (error instanceof NetworkError) return;
      throw error;
    }
  }
}

export const store = new Store();

/** The browser refreshes provider status at least every 3 seconds. */
export function startStatusPolling(onTick: () => void): void {
  const tick = async (): Promise<void> => {
    await store.refreshStatus().catch(() => undefined);
    await store.refreshHold().catch(() => undefined);
    onTick();
  };
  void tick();
  window.setInterval(() => void tick(), STATUS_INTERVAL_MS);
}

/** A poll answering 401 never navigates or clears input. */
export function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiCallError && error.status === 401;
}
