import type { KillBillClient } from './killbill';
import { KillBillError } from './killbill';
import { ApiError } from '../http/errors';

/**
 * The one mapping from a failed Kill Bill call to the published answer:
 * billing is temporarily unavailable and nothing was changed.
 */
export async function kbSafe<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch {
    throw new ApiError('billing_unavailable');
  }
}
