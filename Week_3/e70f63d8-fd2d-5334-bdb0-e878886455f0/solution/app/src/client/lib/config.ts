import type { ApiConfig } from '../../shared/wire.js';
import { get } from './api.js';
import { createStore } from './store.js';

/** The three values the browser takes from the environment (viewer delay, Ball tick roll and stagger). */
export const configStore = createStore<ApiConfig | null>(null);

let pending: Promise<ApiConfig> | null = null;

export const loadConfig = (): Promise<ApiConfig> => {
  pending ??= get<ApiConfig>('/api/config').then((loaded) => {
    configStore.set(loaded);
    return loaded;
  });
  return pending;
};
