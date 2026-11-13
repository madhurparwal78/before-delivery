import { apiGet, onProviderOutage } from './api.js';
import { COPY } from './copy.js';
import { clear, el, prefersReducedMotion, svgIcon } from './dom.js';
import type { ProviderStatus } from '../shared/types.js';

const STATUS_POLL_MS = 30_000;

let state: ProviderStatus = { payments: 'up', storage: 'up' };
let host: HTMLElement | null = null;
let started = false;

/**
 * The service notice shows what the status endpoint last reported, plus any
 * provider that has just failed a request, and clears at the next check that
 * reports it up.
 */
export function mountServiceNotice(container: HTMLElement): HTMLElement {
  host = el('div', { class: 'notice-host' });
  container.append(host);
  render();
  if (!started) {
    started = true;
    onProviderOutage((provider) => {
      state = { ...state, [provider]: 'down' };
      render();
    });
    void poll();
    window.setInterval(() => void poll(), STATUS_POLL_MS);
  }
  return host;
}

async function poll(): Promise<void> {
  try {
    state = await apiGet<ProviderStatus>('/api/status');
  } catch {
    state = { payments: 'down', storage: 'down' };
  }
  render();
}

function banner(heading: string, body: string): HTMLElement {
  return el('div', { class: 'notice-banner' }, [
    svgIcon('alert', 22),
    el('div', {}, [
      el('p', { class: 'notice-heading', role: 'heading', 'aria-level': '2' }, [heading]),
      el('p', { class: 'notice-text' }, [body]),
    ]),
  ]);
}

function render(): void {
  if (host === null) return;
  const down = state.payments === 'down' || state.storage === 'down';
  clear(host);
  if (!down) return;
  const region = el('section', {
    'aria-label': 'Service notice',
    class: prefersReducedMotion() ? 'service-notice' : 'service-notice service-notice-enter',
  });
  if (state.payments === 'down') {
    region.append(banner(COPY.paymentsDownHeading, COPY.paymentsDownText));
  }
  if (state.storage === 'down') {
    region.append(banner(COPY.storageDownHeading, COPY.storageDownText));
  }
  host.append(region);
}
