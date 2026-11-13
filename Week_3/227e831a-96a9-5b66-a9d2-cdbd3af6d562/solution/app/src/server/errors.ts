import type { ApiErrorBody } from '../shared/api-types'

/** A refusal the hiker's client can act on; the only way a route answers with an error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message)
  }
}

export const refuse = {
  payloadTooLarge: () => new HttpError(413, 'payload_too_large', 'That request is too large.'),
  unsupportedMediaType: () => new HttpError(415, 'unsupported_media_type', 'Send the request in the format this route accepts.'),
  crossSite: () => new HttpError(403, 'cross_site_request', 'This request did not come from Skinout.'),
  unauthenticated: () => new HttpError(401, 'unauthenticated', 'Sign in to continue.'),
  notFound: (thing = '') => new HttpError(404, thing ? `${thing}_not_found` : 'not_found', 'That was not found.'),
  invalidJson: () => new HttpError(400, 'invalid_json', 'Send a JSON object.'),
  validation: (fields: Record<string, string>) => new HttpError(422, 'validation_failed', 'Some fields need attention.', fields),
  storageUnavailable: () => new HttpError(503, 'storage_unavailable', 'File storage is unavailable. Try again later.'),
  printingUnavailable: () => new HttpError(503, 'printing_unavailable', "Pack sheets can't be printed right now. Try again later."),
  internal: () => new HttpError(500, 'internal_error', 'Something went wrong. Try again.'),
}

/** The one place an error body is built. */
export function errorBody(error: HttpError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  }
}
