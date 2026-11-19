import { api } from './api';
import { signal } from './signal';
import type { Config } from '../shared/types';

export const configSignal = signal<Config | null>(null);

export async function loadConfig(): Promise<Config | null> {
  const result = await api<Config>('GET', '/api/config');
  if (result.ok) configSignal.set(result.body);
  return configSignal.get();
}
