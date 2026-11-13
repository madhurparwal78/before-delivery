import { copy } from '../../shared/copy.js';
import type { ErrorCode } from '../../shared/copy.js';

interface ErrorExtra { fields?: Record<string, string>; seq?: number; holder?: string | null }

/** An answer the API gives with the one published error shape. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly extra: ErrorExtra = {}) {
    super(message);
  }
}

export const notFound = (): ApiError => new ApiError(404, 'NOT_FOUND', copy.notFound);
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'VALIDATION', copy.fieldErrors, { fields });
