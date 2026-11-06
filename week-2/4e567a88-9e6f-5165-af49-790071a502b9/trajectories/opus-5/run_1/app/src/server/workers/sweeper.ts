import { db } from '../db';
import { noteStorageFailure } from '../services/deps';
import { StorageUnavailable, deleteObject } from '../services/s3';
import { expiredLiveAssets, markRemoved } from '../store/assets';
import { forgetExpiredKeys } from '../store/idempotency';

/** Removes an expired asset's object from storage within fifteen seconds of its expiry. */
async function tick(): Promise<void> {
  await forgetExpiredKeys();
  for (const asset of await expiredLiveAssets()) {
    try {
      await deleteObject(asset.storageKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        noteStorageFailure();
        return;
      }
      throw error;
    }
    await markRemoved(db, asset.id, 'expired', asset.expiresAt);
  }
}

export function startSweeper(): void {
  setInterval(() => {
    tick().catch((error: unknown) => console.error('retention sweep failed', error));
  }, 5000).unref();
}
