import { el } from './dom.js';

const COPY = 'File storage is unavailable. Everything else keeps working.';

let band: HTMLElement | null = null;

export function showStorageOutage(): void {
  if (band && band.isConnected) return;
  band = el('div', { class: 'outage-band', role: 'status' }, COPY);
  const main = document.getElementById('main');
  main?.parentElement?.insertBefore(band, main);
}

export function clearStorageOutage(): void {
  band?.remove();
  band = null;
}
