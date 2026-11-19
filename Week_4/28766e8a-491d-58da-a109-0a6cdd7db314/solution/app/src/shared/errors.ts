// The one API error shape and the error precedence (brief: API, General and Error precedence).

const ERROR_STATUS = {
  unauthenticated: 401,
  bad_credentials: 401,
  not_found: 404,
  forbidden_role: 403,
  cross_origin: 403,
  save_unavailable: 503,
  shape_deleted: 409,
  connector_deleted: 409,
  layer_locked: 409,
  op_conflict: 409,
  undo_conflict: 409,
  email_taken: 409,
  already_member: 409,
  already_invited: 409,
  invite_closed: 409,
  owner_role: 409,
  already_resolved: 409,
  export_not_ready: 409,
  export_not_retryable: 409,
  too_large: 413,
  unsupported_media_type: 415,
  invalid: 422,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}

const NOT_FOUND_MESSAGE = "Diagram not found.";

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  bad_credentials: "Email or password is incorrect.",
  not_found: NOT_FOUND_MESSAGE,
  forbidden_role: "Your role does not allow this.",
  cross_origin: "Requests must come from this site.",
  save_unavailable: "Saving is unavailable right now.",
  shape_deleted: "That shape was deleted.",
  connector_deleted: "That connector was deleted.",
  layer_locked: "That layer is locked.",
  op_conflict: "That operation id was already used with a different body.",
  undo_conflict: "That change can't be undone.",
  email_taken: "An account with this email already exists.",
  already_member: "That person is already a member.",
  already_invited: "That email already has an open invite.",
  invite_closed: "That invite is closed.",
  owner_role: "The owner's role cannot change.",
  already_resolved: "That thread is already resolved.",
  export_not_ready: "That export is not ready.",
  export_not_retryable: "That export cannot be retried.",
  too_large: "The request body is too large.",
  unsupported_media_type: "Send the request body as JSON.",
  invalid: "Some fields are invalid.",
  internal: "Something went wrong.",
};

/** Thrown anywhere on the server; rendered once by the HTTP layer and the socket layer. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message?: string, fields?: Record<string, string>) {
    super(code === "not_found" ? NOT_FOUND_MESSAGE : (message ?? DEFAULT_MESSAGE[code]));
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = fields;
  }

  body(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

/** Throws 422 with field errors when any field has one. */
export function requireFields(fields: Record<string, string | null>): void {
  const found = Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== null));
  if (Object.keys(found).length) throw new ApiError("invalid", "Some fields are invalid.", found);
}
