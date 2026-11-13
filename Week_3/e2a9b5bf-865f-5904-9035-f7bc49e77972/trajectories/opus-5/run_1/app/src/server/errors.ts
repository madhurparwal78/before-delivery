import { FIELD_MESSAGES, type FieldMessageKey } from '../shared/messages.js';

/** Every API error goes through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export class ValidationError extends ApiError {
  constructor(fields: Record<string, string>) {
    super(422, 'validation', { fields });
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const tooLarge = (): ApiError => new ApiError(413, 'too_large');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type');
export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin');
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');

/** Collects field messages from the one published table. */
export class FieldErrors {
  private readonly fields = new Map<string, string>();

  add(field: string, key: FieldMessageKey = field as FieldMessageKey): this {
    if (!this.fields.has(field)) this.fields.set(field, FIELD_MESSAGES[key]);
    return this;
  }

  get empty(): boolean {
    return this.fields.size === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw new ValidationError(Object.fromEntries(this.fields));
  }
}
