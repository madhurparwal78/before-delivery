import { api } from './api';
import { signal, useSignal } from './signal';
import type { Locale } from '../shared/format';
import { DEFAULT_LOCALE } from '../shared/format';

export interface Me extends Locale {
  id: number;
  email: string;
  name: string;
}

export const meSignal = signal<Me | null | undefined>(undefined);

export async function loadMe(): Promise<Me | null> {
  const result = await api<Me>('GET', '/api/me');
  const me = result.ok ? result.body : null;
  meSignal.set(me);
  return me;
}

export const useMe = (): Me | null | undefined => useSignal(meSignal);

export const localeOf = (me: Me | null | undefined): Locale => me ?? DEFAULT_LOCALE;
