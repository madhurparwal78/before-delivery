import { useEffect, useSyncExternalStore } from 'react';
import type { InputState } from '../shared/race-model.js';
import { apiGet } from './api.js';
import type { BoardRow, ChampionshipBody, Garage, LobbyBody, Me } from './types.js';

interface Store<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const meStore = createStore<{ loaded: boolean; me: Me | null }>({
  loaded: false,
  me: null,
});
export const garageStore = createStore<Garage | null>(null);
export const statusStore = createStore<{ replayStorage: 'ok' | 'unavailable' }>({
  replayStorage: 'ok',
});
export const championshipStore = createStore<ChampionshipBody | null>(null);

export const useMe = () => useStore(meStore);
export const useGarage = () => useStore(garageStore);
export const useStatus = () => useStore(statusStore);
export const useChampionship = () => useStore(championshipStore);

/**
 * The visible coin balance and the latest balance the tab knows. Pushes are held
 * while a purchase is pending, unconfirmed, or a sweep is running.
 */
class BalanceStore {
  private visibleValue = 0;
  private latestValue = 0;
  private holds = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVisible = (): number => this.visibleValue;
  getLatest = (): number => this.latestValue;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  learn(balance: number): void {
    this.latestValue = balance;
    if (this.holds === 0) this.visibleValue = balance;
    this.emit();
  }

  setVisible(balance: number): void {
    this.visibleValue = balance;
    this.emit();
  }

  hold(): void {
    this.holds += 1;
  }

  release(): void {
    this.holds = Math.max(0, this.holds - 1);
    if (this.holds === 0) this.visibleValue = this.latestValue;
    this.emit();
  }
}

export const balance = new BalanceStore();

export function useVisibleBalance(): number {
  return useSyncExternalStore(balance.subscribe, balance.getVisible, balance.getVisible);
}

export function useLatestBalance(): number {
  return useSyncExternalStore(balance.subscribe, balance.getLatest, balance.getLatest);
}

export type Push =
  | { type: 'balance'; balance: number; movementId: string; purchaseId: string | null }
  | { type: 'run'; runId: string; status: string }
  | ({ type: 'championship' } & ChampionshipBody)
  | {
      type: 'board';
      layoutId: string;
      mode: string;
      class: string;
      row: BoardRow;
    }
  | ({ type: 'lobby' } & LobbyBody);

const pushListeners = new Set<(push: Push) => void>();
let socket: WebSocket | null = null;

export function usePush(handler: (push: Push) => void): void {
  useEffect(() => {
    pushListeners.add(handler);
    return () => {
      pushListeners.delete(handler);
    };
  }, [handler]);
}

export function connectSocket(): void {
  if (socket !== null && socket.readyState <= WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const next = new WebSocket(`${protocol}://${window.location.host}/v1/ws`);
  socket = next;
  next.addEventListener('message', (event) => {
    const push = JSON.parse(String(event.data)) as Push;
    if (push.type === 'balance') balance.learn(push.balance);
    if (push.type === 'championship') championshipStore.set(push);
    for (const listener of pushListeners) listener(push);
  });
  next.addEventListener('close', () => {
    socket = null;
    window.setTimeout(() => {
      if (meStore.get().me !== null) connectSocket();
    }, 1000);
  });
}

export function sendKeys(input: InputState): void {
  if (socket !== null && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'keys', ...input }));
  }
}

export async function refreshMe(): Promise<Me | null> {
  const result = await apiGet<Me>('/v1/me');
  const me = result.kind === 'ok' ? result.data : null;
  meStore.set({ loaded: true, me });
  if (me !== null) {
    balance.learn(me.balance);
    connectSocket();
  }
  return me;
}

export async function refreshGarage(): Promise<Garage | null> {
  const result = await apiGet<Garage>('/v1/garage');
  if (result.kind !== 'ok') return null;
  garageStore.set(result.data);
  balance.learn(result.data.balance);
  return result.data;
}

export async function refreshChampionship(): Promise<void> {
  const result = await apiGet<ChampionshipBody>('/v1/championship');
  if (result.kind === 'ok') championshipStore.set(result.data);
}

export async function refreshStatus(): Promise<void> {
  const result = await apiGet<{ replayStorage: 'ok' | 'unavailable' }>('/v1/status');
  if (result.kind === 'ok') statusStore.set(result.data);
}

export function startStatusPolling(): void {
  void refreshStatus();
  window.setInterval(() => void refreshStatus(), 5000);
}
