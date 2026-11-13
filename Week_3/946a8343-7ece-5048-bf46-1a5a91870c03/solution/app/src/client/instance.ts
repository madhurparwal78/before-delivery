// Instance status store: whether file storage is up. Seeded from the page config, changed by a live `instance` message or by
// an API answer with code `storage_unavailable`. The status strip in the shell reads it with `useInstance()`.
import { config } from "./config.ts";
import { createStore, useStore } from "./store.ts";

interface InstanceStatus {
  storage: "up" | "down";
}

const instanceStore = createStore<InstanceStatus>({ storage: config.storage });

export function setStorage(storage: "up" | "down"): void {
  if (instanceStore.get().storage !== storage) instanceStore.set({ storage });
}

export function useInstance(): InstanceStatus {
  return useStore(instanceStore);
}

export const STORAGE_DOWN_COPY = "File storage is unavailable. Uploads, artifacts and exports are paused.";
export const STORAGE_UP_COPY = "All systems are running.";
