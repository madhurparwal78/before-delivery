export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }

  body(): { error: { code: string; message: string } & Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const errors = {
  bodyTooLarge: () => new ApiError(413, 'body_too_large', 'That request body is too large.'),
  databaseUnavailable: () =>
    new ApiError(503, 'database_unavailable', 'The database is unavailable.'),
  unknownStaff: () => new ApiError(401, 'unknown_staff', 'Choose who you are working as.'),
  notFound: (message = "That doesn't exist.") => new ApiError(404, 'not_found', message),
  forbidden: (message = "You can't do that.") => new ApiError(403, 'forbidden', message),
  staleVersion: (placement: unknown) =>
    new ApiError(412, 'stale_version', 'Someone else changed this placement first.', {
      placement,
    }),
  unsupportedMediaType: () =>
    new ApiError(415, 'unsupported_media_type', 'Send a JPEG or PNG photo.'),
  validationFailed: (fields: Record<string, string>) =>
    new ApiError(422, 'validation_failed', 'Fix these to continue.', { fields }),
  placementRejected: (reason: string, message: string) =>
    new ApiError(422, 'placement_rejected', message, { reason }),
  imageStoreUnavailable: () =>
    new ApiError(503, 'image_store_unavailable', 'The image store is unavailable.'),
  readOnly: () => new ApiError(405, 'read_only', 'This link is read-only.'),
};
