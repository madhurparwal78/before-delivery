import { t, type Locale, type MessageKey, type MessageParams } from '../shared/i18n/index.js';
import type { ApiErrorBody } from '../shared/types.js';

export interface LocalisedText {
  key: MessageKey;
  params?: MessageParams;
}

/** The single error shape every API failure is built through. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly text: LocalisedText;
  readonly fields: Record<string, LocalisedText> | null;
  readonly headers: Record<string, string>;

  constructor(options: {
    status: number;
    code: string;
    text: LocalisedText;
    fields?: Record<string, LocalisedText>;
    headers?: Record<string, string>;
  }) {
    super(`${options.status} ${options.code}`);
    this.status = options.status;
    this.code = options.code;
    this.text = options.text;
    this.fields = options.fields ?? null;
    this.headers = options.headers ?? {};
  }

  body(locale: Locale): ApiErrorBody {
    const body: ApiErrorBody = {
      error: { code: this.code, message: t(locale, this.text.key, this.text.params) },
    };
    if (this.fields) {
      const fields: Record<string, string> = {};
      for (const [name, text] of Object.entries(this.fields)) {
        fields[name] = t(locale, text.key, text.params);
      }
      body.fields = fields;
    }
    return body;
  }
}

export const errors = {
  unauthenticated: () =>
    new ApiError({ status: 401, code: 'unauthenticated', text: { key: 'fb.signInRequired' } }),
  notFound: () =>
    new ApiError({ status: 404, code: 'not_found', text: { key: 'fb.generic' } }),
  invalidCredentials: () =>
    new ApiError({
      status: 401,
      code: 'invalid_credentials',
      text: { key: 'fb.wrongCredentials' },
    }),
  crossOrigin: () =>
    new ApiError({ status: 403, code: 'cross_origin', text: { key: 'fb.generic' } }),
  notLeader: () =>
    new ApiError({ status: 403, code: 'not_leader', text: { key: 'fb.notLeader' } }),
  emailUnverified: () =>
    new ApiError({ status: 403, code: 'email_unverified', text: { key: 'fb.emailUnverified' } }),
  internal: () => new ApiError({ status: 500, code: 'internal', text: { key: 'fb.generic' } }),
  bodyTooLarge: () =>
    new ApiError({ status: 413, code: 'body_too_large', text: { key: 'fb.generic' } }),
  invalidField: (field: string, text: LocalisedText) =>
    new ApiError({
      status: 422,
      code: 'invalid_body',
      text: { key: 'fb.generic' },
      fields: { [field]: text },
    }),
  invalidFields: (fields: Record<string, LocalisedText>) =>
    new ApiError({ status: 422, code: 'invalid_body', text: { key: 'fb.generic' }, fields }),
  conflict: (code: string, text: LocalisedText) =>
    new ApiError({ status: 409, code, text }),
  staleRevision: () =>
    new ApiError({ status: 412, code: 'stale_revision', text: { key: 'fb.staleSlot' } }),
  gone: (code: string, text: LocalisedText) => new ApiError({ status: 410, code, text }),
  storageUnavailable: (kind: 'upload' | 'delete') =>
    new ApiError({
      status: 503,
      code: 'storage_unavailable',
      text: { key: kind === 'upload' ? 'fb.storageUpload' : 'fb.storageDelete' },
    }),
  mailUnavailable: (kind: 'verification' | 'reset') =>
    new ApiError({
      status: 503,
      code: 'mail_unavailable',
      text: { key: kind === 'verification' ? 'fb.verificationNotSent' : 'fb.resetNotSent' },
    }),
  tooLarge: () =>
    new ApiError({ status: 413, code: 'too_large', text: { key: 'fb.uploadTooLarge' } }),
  quotaExceeded: () =>
    new ApiError({ status: 413, code: 'quota_exceeded', text: { key: 'fb.uploadQuota' } }),
  notGltf: () => new ApiError({ status: 415, code: 'not_gltf', text: { key: 'fb.notGltf' } }),
  unsupportedType: () =>
    new ApiError({ status: 415, code: 'unsupported_type', text: { key: 'fb.notGltf' } }),
  rateLimited: (seconds: number) =>
    new ApiError({
      status: 429,
      code: 'rate_limited',
      text: { key: 'fb.chatCooldown', params: { seconds } },
      headers: { 'Retry-After': String(seconds) },
    }),
};
