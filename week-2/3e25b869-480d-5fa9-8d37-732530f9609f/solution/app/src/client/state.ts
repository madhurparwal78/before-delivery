// Client state: the active locale, the service status and a tiny store hook.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '../shared/catalog.js';
import { copy, type Messages } from '../shared/copy.js';

type Listener = () => void;

class Store<T> {
  private readonly listeners = new Set<Listener>();
  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(s: Store<T>): T {
  const [, force] = useState(0);
  useEffect(() => s.subscribe(() => force((n) => n + 1)), [s]);
  return s.get();
}

function initialLocale(): Locale {
  const cookie = /(?:^|;\s*)pdl_locale=([^;]+)/.exec(document.cookie)?.[1];
  if (cookie === 'fr-CA' || cookie === 'en-CA') return cookie;
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
}

const locale = new Store<Locale>(initialLocale());
document.documentElement.lang = locale.get();

export function setLocale(next: Locale): void {
  document.cookie = `pdl_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = next;
  locale.set(next);
}

export function useCopy(): { m: Messages; l: Locale } {
  const l = useStore(locale);
  return { m: copy(l), l };
}

export interface ServiceStatus {
  billing: 'up' | 'down';
  mail: 'up' | 'down';
}

export const serviceStatus = new Store<ServiceStatus>({ billing: 'up', mail: 'up' });

/** Reduced-motion preference, followed live. */
export const reducedMotion = new Store<boolean>(matchMedia('(prefers-reduced-motion: reduce)').matches);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => reducedMotion.set(e.matches));

/** Wide layout (1024 pixels and above). */
export const wide = new Store<boolean>(matchMedia('(min-width: 1024px)').matches);
matchMedia('(min-width: 1024px)').addEventListener('change', (e) => wide.set(e.matches));
