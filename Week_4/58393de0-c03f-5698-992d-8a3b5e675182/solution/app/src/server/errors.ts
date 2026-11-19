import { ERROR_CATALOG, type ErrorCode } from "../shared/errors";
import type { ErrorBody } from "../shared/types";

interface ErrorDetail {
  message?: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}

/** The one way a request fails: the code picks the status and default copy, the detail adds the rest of the shape. */
export class ApiError extends Error {
  readonly status: number;

  constructor(readonly code: ErrorCode, readonly detail: ErrorDetail = {}) {
    super(detail.message ?? ERROR_CATALOG[code].message);
    this.status = ERROR_CATALOG[code].status;
  }

  toBody(): ErrorBody {
    const { fields, currentRevision, retryAfterSeconds } = this.detail;
    return {
      error: this.code,
      message: this.message,
      ...(fields && { fields }),
      ...(currentRevision !== undefined && { currentRevision }),
      ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
    };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError("validation", { fields });
}

/** Throws the collected field copy, one entry per field, when there is any. */
export function assertNoFieldErrors(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}
