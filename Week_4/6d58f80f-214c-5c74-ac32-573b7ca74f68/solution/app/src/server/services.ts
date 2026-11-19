// Storage and directory health, re-probed on a timer so recovery needs no restart (brief: Services).
import * as storage from "./storage.js";
import * as directory from "./directory.js";
import type { ServiceStatus } from "../shared/api.js";

export const PROBE_MS = 5_000;
export const status: ServiceStatus = { storage: "down", directory: "down" };
const listeners: ((current: ServiceStatus) => void)[] = [];

export function onStatusChange(listener: (current: ServiceStatus) => void): void {
  listeners.push(listener);
}

export async function probe(): Promise<void> {
  const [storageUp, directoryUp] = await Promise.all([storage.ping(), directory.ping()]);
  const next: ServiceStatus = { storage: storageUp ? "up" : "down", directory: directoryUp ? "up" : "down" };
  if (next.storage === status.storage && next.directory === status.directory) return;
  Object.assign(status, next);
  for (const listener of listeners) listener({ ...status });
}
