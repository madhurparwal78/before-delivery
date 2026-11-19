import { copy } from '../domain/copy';

export type Fields = Record<string, string>;

/** The one error shape every endpoint answers with. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Fields | undefined;
  readonly beside: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Fields; beside?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.beside = options.beside;
    this.headers = options.headers;
  }

  body(): { error: Record<string, unknown> } {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.beside) Object.assign(error, this.beside);
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export const problem = {
  notFound: () => new ApiProblem(404, 'not_found', 'That was not found.'),
  methodNotAllowed: (allow: string[]) =>
    new ApiProblem(405, 'method_not_allowed', 'That method is not allowed here.', {
      headers: { Allow: allow.join(', ') },
    }),
  tooLarge: (message: string) => new ApiProblem(413, 'too_large', message),
  rateLimited: (retryAfter: number, message: string) =>
    new ApiProblem(429, 'rate_limited', message, { headers: { 'Retry-After': String(retryAfter) } }),
  invalidCredentials: () => new ApiProblem(401, 'invalid_credentials', copy.wrongSignIn),
  notSignedIn: () => new ApiProblem(401, 'not_signed_in', 'Sign in to keep going.'),
  sessionEnded: () => new ApiProblem(401, 'session_ended', copy.sessionEnded),
  pageEnded: (message: string) => new ApiProblem(410, 'page_ended', message),
  withdrawn: (message: string) => new ApiProblem(410, 'withdrawn', message),
  unsupportedMediaType: (message = 'That content type is not supported here.') =>
    new ApiProblem(415, 'unsupported_media_type', message),
  malformedJson: () => new ApiProblem(400, 'malformed_json', 'That body is not valid JSON.'),
  fields: (fields: Fields) => {
    const first = Object.keys(fields)[0] as string;
    return new ApiProblem(422, 'validation_failed', fields[first] as string, { fields });
  },
  validation: (message: string) => new ApiProblem(422, 'validation_failed', message),
  conflict: (message: string) => new ApiProblem(409, 'conflict', message),
  emailTaken: () => new ApiProblem(409, 'email_taken', 'That email already has a desk.'),
  keyReused: () => new ApiProblem(409, 'key_reused', 'That request key was used with another body.'),
  lowerReading: (message: string, lastValue: string, lastAt: string) =>
    new ApiProblem(409, 'lower_reading', message, { beside: { lastValue, lastAt } }),
  gtinTaken: () => new ApiProblem(409, 'gtin_taken', copy.gtinTaken),
  newerDossier: (message: string) => new ApiProblem(409, 'newer_dossier', message),
  staleEdit: (message: string) => new ApiProblem(412, 'stale_edit', message),
  factorLibraryUnavailable: () =>
    new ApiProblem(503, 'factor_library_unavailable', copy.libraryUnavailable),
  scoreServiceUnavailable: () => new ApiProblem(503, 'score_service_unavailable', copy.scoreUnavailable),
  scoreServiceBusy: (message: string, busyUntil: string) =>
    new ApiProblem(503, 'score_service_busy', message, { beside: { busyUntil } }),
  fileStoreUnavailable: (message: string = copy.fileStoreDown) =>
    new ApiProblem(503, 'file_store_unavailable', message),
  dossierServiceUnavailable: () =>
    new ApiProblem(503, 'dossier_service_unavailable', copy.dossierServiceDown),
};

export class FieldCollector {
  private readonly found: Fields = {};

  add(key: string, message: string): void {
    if (!(key in this.found)) this.found[key] = message;
  }

  get empty(): boolean {
    return Object.keys(this.found).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw problem.fields(this.found);
  }
}
