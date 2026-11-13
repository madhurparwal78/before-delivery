// The offline switch and the groups made while it was on, kept in local storage per drawing and person so they survive a reload.
import type { OperationGroup } from '../../shared/types.ts';

interface StoredGroup { group: OperationGroup; firstHandle: number }

interface OfflineRecord {
  offline: boolean;
  groups: StoredGroup[];
  /** the optimistic handle counter, so `new-<n>` ids stay unique across the reload */
  nextHandle: number;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isRecord(value: unknown): value is OfflineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<OfflineRecord>;
  return typeof record.offline === 'boolean' && Array.isArray(record.groups) && typeof record.nextHandle === 'number';
}

export class OfflineQueue {
  private readonly key: string;

  constructor(private readonly storage: Storage, drawingId: string, username: string) {
    this.key = `plotfold.offline.${drawingId}.${username}`;
  }

  load(): OfflineRecord | null {
    const text = this.storage.getItem(this.key);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  }

  /** Online with nothing waiting leaves no record. */
  save(record: OfflineRecord): void {
    if (!record.offline && record.groups.length === 0) this.storage.removeItem(this.key);
    else this.storage.setItem(this.key, JSON.stringify(record));
  }
}
