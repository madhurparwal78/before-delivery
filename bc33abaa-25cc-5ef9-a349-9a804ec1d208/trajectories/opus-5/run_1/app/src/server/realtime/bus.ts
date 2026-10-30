import { Author, CommentDto, LockDto, OpDto, VersionDto } from '../../shared/api';

export type SceneEvent =
  | { event: 'op'; data: { batchId: string; ops: OpDto[] } }
  | { event: 'lock'; data: { nodeId: string; holder: Author | null } }
  | { event: 'presence'; data: { authors: { author: Author; selection: string | null }[] } }
  | { event: 'comment'; data: CommentDto }
  | { event: 'version'; data: VersionDto };

type Listener = (event: SceneEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(sceneId: string, listener: Listener): () => void {
  const set = listeners.get(sceneId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(sceneId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sceneId);
  };
}

export function publish(sceneId: string, event: SceneEvent): void {
  const set = listeners.get(sceneId);
  if (!set) return;
  for (const listener of set) listener(event);
}

export function publishLock(sceneId: string, lock: LockDto | { nodeId: string }): void {
  const holder = 'holder' in lock ? lock.holder : null;
  publish(sceneId, { event: 'lock', data: { nodeId: lock.nodeId, holder } });
}
