import { LIMITS } from '../config.js';
import { killbill } from './killbill.js';

let billingUp = true;
let checkedAt = new Date();
let catalogReady = false;

export function billingStatus(): { up: boolean; checkedAt: Date } {
  return { up: billingUp, checkedAt };
}

export function noteBillingFailure(): void {
  billingUp = false;
  checkedAt = new Date();
}

async function check(): Promise<void> {
  try {
    await killbill.readCatalog();
    billingUp = true;
  } catch {
    billingUp = false;
    checkedAt = new Date();
    return;
  }
  checkedAt = new Date();
  if (catalogReady) return;
  try {
    await killbill.ensureCatalog();
    catalogReady = true;
  } catch {
    catalogReady = false;
  }
}

export function startBillingMonitor(): void {
  setInterval(() => void check(), LIMITS.monitorIntervalMs);
  void check();
}
