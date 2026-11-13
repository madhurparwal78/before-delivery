export type Body = Record<string, unknown>

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: Body, readonly headers: Record<string, string> = {}) {
    super(JSON.stringify(body))
  }
}

export const fail = (status: number, error: string, extra: Body = {}, headers: Record<string, string> = {}): never => {
  throw new ApiError(status, { error, ...extra }, headers)
}

export const notFound = (): never => fail(404, 'not_found')

export function validation(fields: Record<string, string>, extra: Body = {}): never {
  return fail(422, 'validation', { fields, ...extra })
}

/** The reply for any error: an `ApiError` as it is, anything else logged and answered as a plain 500. */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  console.error(error)
  return new ApiError(500, { error: 'internal' })
}
