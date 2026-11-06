export class ApiError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.error = error;
    Object.assign(this, extra);
  }
}

export const errors = {
  signedOut: () => new ApiError(401, 'Sign in to continue.'),
  sessionEnded: () => new ApiError(401, 'Your session has ended. Sign in again.'),
  signInRefused: () => new ApiError(401, 'Those details do not match an account'),
  signInUnavailable: () => new ApiError(503, 'Sign-in is unavailable right now. Try again shortly.'),
  signInLocked: (retryAfter) =>
    Object.assign(new ApiError(429, 'Too many attempts for this address. Try again later.'), {
      retryAfter,
    }),
  signInRequired: (field) => new ApiError(400, `${field} is required.`, { field }),
  nulCharacter: (field) =>
    new ApiError(400, `${field} cannot contain a NUL character.`, { field }),
  unpublishedKey: (key) => new ApiError(400, `${key} cannot be set here.`, { field: key }),
  unknownEndpoint: () => new ApiError(404, 'No such endpoint.'),
  methodNotAllowed: (allow) =>
    Object.assign(new ApiError(405, 'Method not allowed.'), { allow }),
  noSuchRequest: () => new ApiError(404, 'No such request.'),
  noSuchPerson: () => new ApiError(404, 'No such person.'),
  noSuchLink: () => new ApiError(404, 'No such link.'),
  serverError: () => new ApiError(500, 'The desk could not complete that. Try again.'),
};
