import { APP_NOW, startedAt } from './config.js';

const MS_PER_SECOND = 1000;

// One business clock. APP_NOW fixes its starting instant; otherwise it is the
// system clock. It advances in real time from the moment serve started.
export function now() {
  if (APP_NOW) {
    const base = Date.parse(APP_NOW);
    if (Number.isFinite(base)) return base + (Date.now() - startedAt);
  }
  return Date.now();
}

export function nowIso() {
  return new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoAt(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
