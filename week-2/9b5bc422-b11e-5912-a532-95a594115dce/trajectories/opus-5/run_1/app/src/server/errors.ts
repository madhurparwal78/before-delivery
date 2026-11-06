export type ErrorBody = { errors: Record<string, string> };

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, field: string, message: string) {
    super(message);
    this.status = status;
    this.body = { errors: { [field]: message } };
  }
}

export const apiError = {
  unavailable: () => new ApiError(503, 'form', 'The server is unavailable.'),
  unauthenticated: () => new ApiError(401, 'form', 'Sign in again.'),
  notFound: () => new ApiError(404, 'form', 'Not found.'),
  tooLarge: () => new ApiError(413, 'form', 'That request is too large.'),
  crossOrigin: () => new ApiError(403, 'form', 'Cross-origin requests are not allowed.'),
  readOnlyLink: () => new ApiError(405, 'form', 'This link is read only.'),
  deadLink: () => new ApiError(404, 'form', 'This link no longer works.'),
  emailTaken: () => new ApiError(409, 'email', 'That email already has an account.'),
  invalidEmail: () => new ApiError(422, 'email', 'Enter a valid email address.'),
  shortPassword: () => new ApiError(422, 'password', 'Use at least 8 characters.'),
  badCredentials: () => new ApiError(401, 'form', 'That email and password do not match.'),
  currentDevice: () => new ApiError(409, 'form', 'Use Sign out on this device.'),
  attachmentIdUsed: () => new ApiError(409, 'form', 'That attachment id is already used.'),
  fileTooLarge: () => new ApiError(413, 'file', 'That file is larger than 5,000,000 bytes.'),
  storageFull: () => new ApiError(507, 'file', 'Your account storage is full.'),
  badAttachmentId: () => new ApiError(422, 'id', 'Use a UUID.'),
  missingDocumentId: () => new ApiError(422, 'documentId', 'Enter a document id.'),
};
