// Dependency state: storage and billing are checked every few seconds from boot, so the app starts and
// serves whatever their state, and every part of it reads one answer.

import { checkBilling } from "./billing";
import { checkBucket } from "./storage";

const CHECK_MS = 5_000;

type ServiceState = "up" | "down";

interface Snapshot {
  storage: ServiceState;
  billing: ServiceState;
  checkedAt: Date;
}

const state: Snapshot = { storage: "down", billing: "down", checkedAt: new Date() };
const recoveries: Array<() => void> = [];

export function dependencyState(): Readonly<Snapshot> {
  return state;
}

export const storageDown = (): boolean => state.storage === "down";

/** A failed write or delete marks storage down at once; the next check brings it back. */
export function markStorageDown(): void {
  state.storage = "down";
}

/** Runs `work` whenever a service comes back. */
export function onRecovery(work: () => void): void {
  recoveries.push(work);
}

async function check(): Promise<void> {
  const [storageOk, billingOk] = await Promise.all([checkBucket(), checkBilling()]);
  const returned = (storageOk && state.storage === "down") || (billingOk && state.billing === "down");
  state.storage = storageOk ? "up" : "down";
  state.billing = billingOk ? "up" : "down";
  state.checkedAt = new Date();
  if (returned) recoveries.forEach((work) => work());
}

export function watchDependencies(): void {
  const loop = (): void => {
    void check().finally(() => setTimeout(loop, CHECK_MS));
  };
  loop();
}
