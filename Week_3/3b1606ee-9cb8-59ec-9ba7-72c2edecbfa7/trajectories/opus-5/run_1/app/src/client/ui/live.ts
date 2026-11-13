import { copy, say } from '../copy.js';
import { state } from '../data/store.js';
import { reducedMotion } from './motion.js';

/** The live regions and banners the whole app reports through. */

interface Regions {
  updates: HTMLElement;
  notifications: HTMLElement;
  connection: HTMLElement;
  outage: HTMLElement;
}

let regions: Regions | null = null;
let connectingTimer: number | null = null;
let updatingUntil = 0;
let updatingTimer: number | null = null;

export function registerRegions(value: Regions): void {
  regions = value;
}

export function announce(text: string): void {
  if (regions === null) return;
  regions.updates.textContent = text;
}

export interface ToastRequest {
  text: string;
  conversationId: string;
}

let openToast: ((request: ToastRequest) => void) | null = null;

export function registerToaster(toaster: (request: ToastRequest) => void): void {
  openToast = toaster;
}

export function raiseToast(request: ToastRequest): void {
  openToast?.(request);
}

function connectionBar(testid: string, text: string): HTMLElement {
  const bar = document.createElement('p');
  bar.className = 'bar';
  bar.dataset['testid'] = testid;
  bar.textContent = text;
  return bar;
}

function renderConnection(): void {
  if (regions === null) return;
  regions.connection.replaceChildren();
  if (state.collecting > 0) {
    regions.connection.append(
      connectionBar('updating-bar', say.updating(state.collecting)),
    );
    return;
  }
  if (state.connection === 'connecting') {
    regions.connection.append(connectionBar('connecting-bar', copy.connecting));
  }
}

/** The Connecting bar appears the published delay after the connection drops. */
export function setConnected(connected: boolean): void {
  if (connected) {
    if (connectingTimer !== null) window.clearTimeout(connectingTimer);
    connectingTimer = null;
    state.connection = 'online';
    renderConnection();
    return;
  }
  if (state.connection === 'connecting' || connectingTimer !== null) return;
  connectingTimer = window.setTimeout(() => {
    connectingTimer = null;
    state.connection = 'connecting';
    renderConnection();
  }, state.config.timers.connecting_delay_ms);
}

/** The Updating bar shows the held count and stays for at least one second. */
export function setCollecting(count: number): void {
  if (count > 0) {
    state.collecting = count;
    updatingUntil = Date.now() + 1000;
    renderConnection();
    return;
  }
  const wait = Math.max(0, updatingUntil - Date.now());
  if (updatingTimer !== null) window.clearTimeout(updatingTimer);
  updatingTimer = window.setTimeout(() => {
    updatingTimer = null;
    state.collecting = 0;
    renderConnection();
  }, wait);
}

export function setStorageOutage(unavailable: boolean): void {
  state.storageOut = unavailable;
  if (regions === null) return;
  regions.outage.replaceChildren();
  if (!unavailable) return;
  const banner = document.createElement('p');
  banner.className = 'seam';
  banner.dataset['testid'] = 'outage-banner';
  banner.textContent = copy.outage;
  regions.outage.append(banner);
  if (reducedMotion()) return;
  banner.animate(
    [
      { opacity: 0, transform: 'translateY(-6px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' },
  );
}
