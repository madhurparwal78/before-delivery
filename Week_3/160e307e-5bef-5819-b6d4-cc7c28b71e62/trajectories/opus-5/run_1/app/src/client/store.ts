import { api } from './api.js';
import type { Config, Me } from './api.js';
import { OUTAGE_BANNER } from './copy.js';
import { need } from './dom.js';

interface State {
  me: Me | null;
  config: Config;
  outage: boolean;
}

const FALLBACK_CONFIG: Config = {
  verdictBannerMs: 2000,
  shotTimerSeconds: 20,
  reconnectSeconds: 60,
  rematchSeconds: 60,
  roomExpirySeconds: 600,
  bandWidenSeconds: 5,
  modelVersion: 'dc-model-1',
};

export const state: State = { me: null, config: FALLBACK_CONFIG, outage: false };

export async function refreshMe(): Promise<Me | null> {
  try {
    state.me = await api.get<Me>('/api/me');
  } catch {
    state.me = null;
  }
  return state.me;
}

export async function loadConfig(): Promise<void> {
  try {
    state.config = await api.get<Config>('/api/config');
  } catch {
    state.config = FALLBACK_CONFIG;
  }
}

function paintBanner(): void {
  const banner = need('outage-banner');
  banner.textContent = state.outage ? OUTAGE_BANNER : '';
  for (const node of document.querySelectorAll<HTMLButtonElement>('[data-needs-online]')) {
    node.disabled = state.outage || node.hasAttribute('data-locked');
  }
}

/** The outage banner is checked on load and every 10 seconds. */
export async function checkHealth(): Promise<void> {
  let outage = false;
  try {
    const health = await api.get<{ status: string }>('/api/health');
    outage = health.status !== 'ok';
  } catch {
    outage = true;
  }
  state.outage = outage;
  paintBanner();
}

export function startHealthLoop(): void {
  void checkHealth();
  window.setInterval(() => void checkHealth(), 10000);
}

export function applyOutageState(): void {
  paintBanner();
}
