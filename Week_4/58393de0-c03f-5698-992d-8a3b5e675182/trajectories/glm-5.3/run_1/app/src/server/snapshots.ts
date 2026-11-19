import type { Storage } from './storage.js';

export interface SnapshotStore {
  put(projectId: string, revision: number, snapshot: string): Promise<void>;
  get(projectId: string, revision: number): Promise<string>;
  del(projectId: string, revision: number): Promise<void>;
}

export function createSnapshotStore(storage: Storage): SnapshotStore {
  return {
    async put(projectId, revision, snapshot) {
      await storage.put(`projects/${projectId}/rev-${revision}.json`, Buffer.from(snapshot, 'utf8'));
    },
    async get(projectId, revision) {
      return (await storage.get(`projects/${projectId}/rev-${revision}.json`)).toString('utf8');
    },
    async del(projectId, revision) {
      await storage.del(`projects/${projectId}/rev-${revision}.json`);
    },
  };
}
