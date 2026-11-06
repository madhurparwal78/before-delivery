import type { ApiErrorBody, Task } from '../../shared/types.js';

interface ErrorExtra {
  fields?: Record<string, string>;
  current?: Task | Task[];
  blocked_by?: string[];
  tasks?: string[];
}

/** The one shape every API error takes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const apiError = {
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'This request came from another origin.'),
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'That request body is too large.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'Send this request as JSON.'),
  malformedJson: (): ApiError =>
    new ApiError(400, 'malformed_json', "That request body isn't valid JSON."),
  notFound: (message = "That isn't in the prompt book."): ApiError =>
    new ApiError(404, 'not_found', message),
  notFoundTasks: (tasks: string[]): ApiError =>
    new ApiError(404, 'not_found', 'Some of those tasks are not in the prompt book.', { tasks }),
  preconditionRequired: (): ApiError =>
    new ApiError(428, 'precondition_required', 'Send If-Match with the version you edited.'),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(409, 'idempotency_key_reused', 'That key was used for another request.'),
  versionConflict: (message: string, current: Task | Task[]): ApiError =>
    new ApiError(412, 'version_conflict', message, { current }),
  validation: (fields: Record<string, string>): ApiError =>
    new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { fields }),
  conflict: (code: string, message: string, extra: ErrorExtra = {}): ApiError =>
    new ApiError(409, code, message, extra),
  intakeUnavailable: (): ApiError =>
    new ApiError(503, 'intake_unavailable', 'Request intake is unreachable.'),
  intakeRejected: (): ApiError =>
    new ApiError(502, 'intake_rejected', 'Request intake refused the decision.'),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'Plot storage is unreachable.'),
};
