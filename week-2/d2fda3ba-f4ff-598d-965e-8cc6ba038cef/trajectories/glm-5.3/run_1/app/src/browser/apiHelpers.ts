import type { QueuedRevision } from './store';
import { get, save, newIdemKey } from './store';

export const queueRevision = (noteId: string, baseRevision: number | null, plaintext: string): void => {
  const queue: QueuedRevision[] = [...get().queue, { noteId, baseRevision, idemKey: newIdemKey(), plaintext, createdAt: Date.now() }];
  save({ queue });
};

export const popQueue = (): QueuedRevision | undefined => {
  const q = get().queue;
  if (!q.length) return undefined;
  const [first, ...rest] = q;
  save({ queue: rest });
  return first;
};
