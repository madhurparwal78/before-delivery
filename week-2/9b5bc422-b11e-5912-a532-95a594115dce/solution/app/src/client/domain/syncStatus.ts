type SyncState = "synced" | "syncing" | "offline" | "error";

type SyncSituation = {
  syncing: boolean;
  online: boolean;
  serviceAvailable: boolean;
  waiting: number;
};

export type SyncStatus = { state: SyncState; sentence: string };

const itemCount = (count: number): string => (count === 1 ? "1 item" : `${count} items`);

/** The Sync status table: the first matching row wins. */
export function syncStatus({ syncing, online, serviceAvailable, waiting }: SyncSituation): SyncStatus {
  const items = itemCount(waiting);
  if (!online && syncing) return { state: "offline", sentence: `You are offline. ${items} waiting to sync.` };
  if (!online) return { state: "offline", sentence: "You are offline. This workspace is only on this device." };
  if (!serviceAvailable && syncing) return { state: "error", sentence: `Sync is unavailable. ${items} waiting to sync.` };
  if (!serviceAvailable) return { state: "error", sentence: "Sync is unavailable. This workspace is only on this device." };
  if (!syncing) return { state: "offline", sentence: "This workspace is only on this device." };
  if (waiting > 0) return { state: "syncing", sentence: `Syncing ${items}.` };
  return { state: "synced", sentence: "All changes are synced." };
}
