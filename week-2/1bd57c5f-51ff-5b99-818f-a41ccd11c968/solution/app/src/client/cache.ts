import type { Item, Job, Room, SyncOp, User } from "../shared/domain";

// What the phone keeps so a job opened online opens again with no signal: the signed-in
// user, each opened job's last snapshot, and its queue of offline changes. Access codes
// are never stored.

export interface JobSnapshot {
  job: Job;
  rooms: Room[];
  items: Item[];
}

export interface StoredQueue {
  ops: SyncOp[];
  /** The next client sequence number on this device for this job. */
  nextSeq: number;
  /** client_item_id → server id, learned when a queued creation syncs. */
  ids: Record<string, string>;
  /** The number each queued change's item had, so a row removed meanwhile can still be named. */
  numbers: Record<string, number>;
}

const ME = "snaglight:me";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app keeps working online.
  }
}

export const cache = {
  me: (): User | null => read<User>(ME),
  saveMe: (user: User | null) => (user ? write(ME, user) : localStorage.removeItem(ME)),
  job: (email: string, jobId: string) => read<JobSnapshot>(`snaglight:job:${email}:${jobId}`),
  saveJob: (email: string, snapshot: JobSnapshot) => write(`snaglight:job:${email}:${snapshot.job.id}`, snapshot),
  queue: (email: string, jobId: string): StoredQueue =>
    ({ ops: [], nextSeq: 1, ids: {}, numbers: {}, ...read<Partial<StoredQueue>>(`snaglight:queue:${email}:${jobId}`) }),
  saveQueue: (email: string, jobId: string, queue: StoredQueue) => write(`snaglight:queue:${email}:${jobId}`, queue),
  /** On sign-out everything the phone holds for the account goes. */
  clear: () => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("snaglight:")) localStorage.removeItem(key);
    if ("caches" in window) void caches.delete("snaglight-plans");
  },
};
