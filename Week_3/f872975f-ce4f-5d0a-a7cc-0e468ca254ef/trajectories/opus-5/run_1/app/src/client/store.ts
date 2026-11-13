import { Unit } from '../shared/units';
import { getJson } from './api';
import { SessionUser } from './types';

export interface ServicesReport {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
}

const UNIT_KEY = 'kerfwell.units';

interface Store {
  user: SessionUser | null;
  services: ServicesReport;
}

export const store: Store = {
  user: null,
  services: { billing: 'up', storage: 'up' }
};

const unitListeners = new Set<(unit: Unit) => void>();
const serviceListeners = new Set<(report: ServicesReport) => void>();

export function unit(): Unit {
  return window.localStorage.getItem(UNIT_KEY) === 'in' ? 'in' : 'mm';
}

export function setUnit(next: Unit): void {
  window.localStorage.setItem(UNIT_KEY, next);
  for (const listener of unitListeners) listener(next);
}

export function onUnitChange(listener: (unit: Unit) => void): () => void {
  unitListeners.add(listener);
  return () => unitListeners.delete(listener);
}

export function onServicesChange(listener: (report: ServicesReport) => void): () => void {
  serviceListeners.add(listener);
  return () => serviceListeners.delete(listener);
}

function signedInMarker(): boolean {
  return document.cookie.split(';').some((part) => part.trim().startsWith('kerfwell_signed_in=1'));
}

export async function loadSession(): Promise<SessionUser | null> {
  if (!signedInMarker()) {
    store.user = null;
    return null;
  }
  const result = await getJson<{ user: SessionUser }>('/api/session');
  store.user = result.ok && result.data !== null ? result.data.user : null;
  return store.user;
}

export async function refreshServices(): Promise<ServicesReport> {
  const result = await getJson<ServicesReport>('/api/services');
  if (result.ok && result.data !== null) {
    const changed = result.data.billing !== store.services.billing || result.data.storage !== store.services.storage;
    store.services = result.data;
    if (changed) for (const listener of serviceListeners) listener(store.services);
  }
  return store.services;
}

export function startServiceWatch(): void {
  void refreshServices();
  window.setInterval(() => {
    void refreshServices();
  }, 4000);
}
