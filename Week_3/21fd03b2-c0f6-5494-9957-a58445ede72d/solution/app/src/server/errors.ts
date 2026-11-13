interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> };
}

/** Every refusal in the API is one of these; `errorBody` is the single place the error shape is built. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorBody(error: ApiError): ErrorBody {
  return { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.details ? { details: error.details } : {}) } };
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "We couldn't find that.");
export const linkNotFound = (): ApiError => new ApiError(404, "link_not_found", "This link does not work.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role in this workspace cannot do that.");
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const validation = (fields: Record<string, string>): ApiError => new ApiError(422, "validation", "Check the highlighted values.", fields);
export const lockStoreUnavailable = (): ApiError => new ApiError(503, "lock_store_unavailable", "Live editing is paused because the lock service is unreachable.");
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable", "File storage is unreachable.");

export class LockStoreError extends Error {}
export class StorageError extends Error {}
