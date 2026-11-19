import { ApiError } from '../shared/errors.ts';
import { StorageError, objectExists, putObject } from './s3.ts';

/** How outline text is stored: uploaded imports and Sprig exports. */
export const OUTLINE_TYPE = 'text/plain; charset=utf-8';

/** The outage sentence for storage reads, which the brief gives no dedicated copy for. */
export const STORAGE_DOWN = 'File storage is unavailable.';

/** Write an object and ask the store for it again. A stored-object state may change only after this returns. */
export async function putConfirmed(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await putObject(key, body, contentType);
  if (!(await objectExists(key))) throw new StorageError('The stored object could not be confirmed.');
}

/** Run a storage call and answer an outage as 503 `storage_unavailable` with the given copy. */
export async function orUnavailable<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageError) throw new ApiError('storage_unavailable', message);
    throw error;
  }
}
