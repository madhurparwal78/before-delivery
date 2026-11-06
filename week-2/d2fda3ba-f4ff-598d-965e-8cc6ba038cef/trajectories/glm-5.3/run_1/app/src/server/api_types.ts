export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'idempotency_key_reused'
  | 'forbidden'
  | 'not_entitled'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'validation_failed'
  | 'email_taken'
  | 'invalid_credentials'
  | 'link_used'
  | 'link_expired'
  | 'device_not_approved'
  | 'not_vault_owner'
  | 'invite_email_mismatch'
  | 'sync_not_entitled'
  | 'publish_not_entitled'
  | 'revision_conflict'
  | 'vault_read_only'
  | 'slug_taken'
  | 'invalid_transition'
  | 'publish_in_progress'
  | 'preview_link_inactive'
  | 'already_subscribed'
  | 'not_subscribed'
  | 'not_operator'
  | 'sweep_running'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'cross_origin'
  | 'method_not_allowed'
  | 'internal_error';

const statusByCode: Record<ErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  idempotency_key_reused: 409,
  forbidden: 403,
  not_entitled: 402,
  billing_unavailable: 503,
  storage_unavailable: 503,
  validation_failed: 422,
  email_taken: 409,
  invalid_credentials: 401,
  link_used: 409,
  link_expired: 410,
  device_not_approved: 403,
  not_vault_owner: 403,
  invite_email_mismatch: 403,
  sync_not_entitled: 402,
  publish_not_entitled: 402,
  revision_conflict: 409,
  vault_read_only: 403,
  slug_taken: 409,
  invalid_transition: 409,
  publish_in_progress: 409,
  preview_link_inactive: 409,
  already_subscribed: 409,
  not_subscribed: 409,
  not_operator: 403,
  sweep_running: 409,
  unsupported_media_type: 415,
  payload_too_large: 413,
  cross_origin: 403,
  method_not_allowed: 404,
  internal_error: 500,
};

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, opts?: { fields?: Record<string, string>; extra?: Record<string, unknown> }) {
    super(message);
    this.code = code;
    this.status = statusByCode[code];
    this.fields = opts?.fields;
    this.extra = opts?.extra;
  }
}

export type RawBody = { buf: Buffer; json: () => unknown };

export type Ctx = {
  url: URL;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: RawBody | undefined;
  accountId: string | null;
  deviceId: string | null;
  accountOperator: boolean;
  accountEmail: string | null;
  accountTimeZone: string | null;
  cookies: Record<string, string>;
  setCookie: (value: string) => void;
  originOk: boolean;
};

export type Handler = (ctx: Ctx) => Promise<
  { status: number; body?: unknown; headers?: Record<string, string> } | undefined
>;
