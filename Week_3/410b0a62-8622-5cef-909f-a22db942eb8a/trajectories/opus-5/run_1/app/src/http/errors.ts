export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'The request is too large.');
}

export function invalidCredentials(): ApiError {
  return new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
}

export function uploadStorageUnavailable(): ApiError {
  return new ApiError(
    503,
    'storage_unavailable',
    'Activity storage is unavailable. Your file was not saved; try again in a few minutes.',
  );
}

export function originalStorageUnavailable(): ApiError {
  return new ApiError(
    503,
    'storage_unavailable',
    'Original files are unavailable right now; try again in a few minutes.',
  );
}
