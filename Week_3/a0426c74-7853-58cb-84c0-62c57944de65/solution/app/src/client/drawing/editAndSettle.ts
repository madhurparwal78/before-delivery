import type { DrawingStore, OpInput } from '../store/index.ts';

/**
 * Makes a group and waits until the store has no unconfirmed operations left; true when the drawing's revision moved, so the group was applied.
 * A refused group (a toast shows) settles at once with false.
 */
export async function editAndSettle(store: DrawingStore, command: string, ops: readonly OpInput[]): Promise<boolean> {
  const before = store.getSnapshot().revision;
  store.edit(command, ops);
  await new Promise<void>((resolve) => {
    const settled = (): boolean => store.getSnapshot().pendingOps === 0;
    if (settled()) {
      resolve();
      return;
    }
    const stop = store.subscribe(() => {
      if (!settled()) return;
      stop();
      resolve();
    });
  });
  return store.getSnapshot().revision > before;
}
