import { ApiError } from '../shared/errors.ts';

/** Runs a storage action; when storage does not confirm, the refusal carries the action's own outage sentence. */
export async function withOutageText<T>(sentence: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'storage_unavailable') throw new ApiError('storage_unavailable', sentence);
    throw error;
  }
}
