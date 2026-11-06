import type { Bilingual } from '../../shared/catalog.js';
import { STUDIO, VALIDATION_SUMMARY, t } from '../../shared/copy.js';
import type { ApiErrorBody, Locale } from '../../shared/types.js';

export type FieldErrors = Record<string, Bilingual>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly text: Bilingual;
  readonly fields: FieldErrors | undefined;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    text: Bilingual,
    options: { fields?: FieldErrors; headers?: Record<string, string> } = {},
  ) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.text = text;
    this.fields = options.fields;
    this.headers = options.headers ?? {};
  }

  body(locale: Locale): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.text[locale] };
    if (this.fields) {
      const fields: Record<string, string> = {};
      for (const key of Object.keys(this.fields).sort()) {
        const value = this.fields[key];
        if (value) fields[key] = value[locale];
      }
      error.fields = fields;
    }
    return { error };
  }
}

export const errors = {
  unsupportedMediaType: (): ApiError =>
    new ApiError(
      415,
      'unsupported_media_type',
      t('Send this request as application/json.', 'Envoyez cette requête en application/json.'),
    ),
  payloadTooLarge: (): ApiError =>
    new ApiError(
      413,
      'payload_too_large',
      t('That request body is too large.', 'Le corps de cette requête est trop volumineux.'),
    ),
  crossOrigin: (): ApiError =>
    new ApiError(
      403,
      'cross_origin',
      t('Requests must come from this site.', 'Les requêtes doivent provenir de ce site.'),
    ),
  unauthenticated: (): ApiError =>
    new ApiError(401, 'unauthenticated', t('Sign in to continue.', 'Connectez-vous pour continuer.')),
  notFound: (): ApiError =>
    new ApiError(
      404,
      'not_found',
      t(
        "That page or record doesn't exist, or it isn't yours.",
        "Cette page ou ce dossier n'existe pas, ou ne vous appartient pas.",
      ),
    ),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', STUDIO.forbidden),
  methodNotAllowed: (): ApiError =>
    new ApiError(
      405,
      'method_not_allowed',
      t('That method is not allowed here.', "Cette méthode n'est pas permise ici."),
    ),
  auditImmutable: (): ApiError =>
    new ApiError(
      405,
      'audit_immutable',
      t('The audit log is append-only.', 'Le journal financier est en ajout seul.'),
    ),
  idempotencyKeyRequired: (): ApiError =>
    new ApiError(
      400,
      'idempotency_key_required',
      t('Send an Idempotency-Key header.', 'Envoyez un en-tête Idempotency-Key.'),
    ),
  idempotencyKeyInvalid: (): ApiError =>
    new ApiError(
      400,
      'idempotency_key_invalid',
      t(
        'The Idempotency-Key must be 8 to 64 letters, digits, hyphens or underscores.',
        "L'en-tête Idempotency-Key doit compter de 8 à 64 lettres, chiffres, traits d'union ou soulignés.",
      ),
    ),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(
      409,
      'idempotency_key_reused',
      t(
        'That idempotency key was used with a different request.',
        'Cette clé a déjà servi pour une autre requête.',
      ),
    ),
  requestInProgress: (): ApiError =>
    new ApiError(
      409,
      'request_in_progress',
      t('That request is still running.', 'Cette requête est encore en cours.'),
    ),
  preconditionRequired: (): ApiError =>
    new ApiError(
      428,
      'precondition_required',
      t('Send an If-Match header with the record version.', "Envoyez un en-tête If-Match avec la version du dossier."),
    ),
  staleVersion: (): ApiError => new ApiError(412, 'stale_version', STUDIO.staleVersion),
  conflict: (code: string, text: Bilingual): ApiError => new ApiError(409, code, text),
  gone: (code: string, text: Bilingual): ApiError => new ApiError(410, code, text),
  invalid: (fields: FieldErrors): ApiError =>
    new ApiError(422, 'invalid', VALIDATION_SUMMARY, { fields }),
  rateLimited: (retryAfterSeconds: number, text: Bilingual): ApiError =>
    new ApiError(429, 'rate_limited', text, {
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }),
  stepupLocked: (text: Bilingual): ApiError => new ApiError(429, 'stepup_locked', text),
  billingUnavailable: (text: Bilingual): ApiError => new ApiError(503, 'billing_unavailable', text),
};
