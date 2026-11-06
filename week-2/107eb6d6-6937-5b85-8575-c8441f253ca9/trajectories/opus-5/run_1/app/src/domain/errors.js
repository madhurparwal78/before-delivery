export const COPY = {
  accessRefused: 'You do not have access to this page.',
  requestNotFound: 'This request does not exist or you cannot see it.',
  unavailable: 'The desk cannot reach its records right now. Try again shortly.',
  invalidCredentials: 'Invalid email or password.',
  rateLimited: 'Too many sign-in attempts. Try again later.',
  notJson: 'Request body is not valid JSON.',
  tooLarge: 'Request body is too large.',
  unsupportedMediaType: 'Send the body as application/json.',
  badRequestStatus: 'status must be submitted, confirmed or declined.',
  badTruckStatus: 'status must be available, assigned or maintenance.',
  badLimit: 'limit must be a whole number from 1 to 100.',
  badCursor: 'cursor is not valid.',
  requestDecided: 'This request has already been decided.',
  truckUnavailable: 'This truck is not available.',
  requestFull: 'This request already has every truck it asked for.',
  confirmShort: 'Assign every requested truck before confirming.',
  truckOnRequest: 'This truck is on a request.',
  lastAdmin: 'At least one admin is required.',
  notFoundHeadline: '404. Wrong venue.',
  notFoundLine: 'This address is not on the run sheet.',
  timelineFailed: 'Could not load activity. Try again.'
};

export const FIELD_REASONS = {
  tourNameRequired: 'Tour name is required.',
  tourNameLength: 'Tour name must be 80 characters or fewer.',
  transportType: 'Choose a type of transportation.',
  trucksRequested: 'Enter a number of trucks from 1 to 8.',
  stopMissing: 'This stop is required.',
  address: 'Address is required.',
  city: 'City is required.',
  region: 'State or province is required.',
  postalCode: 'Postal code is required.',
  country: 'Country is required.',
  date: 'Enter a valid date.',
  deliveryBeforePickup: 'Delivery cannot be before pickup.',
  lastShowBeforeFirst: 'Last show cannot be before the first show.',
  notesLength: 'Notes must be 500 characters or fewer.',
  draftId: 'Enter a valid draft id.',
  decision: 'Choose confirm or decline.',
  noteRequired: 'Add a note to explain your decision.',
  noteLength: 'Note must be 500 characters or fewer.',
  truckId: 'Choose a truck from the fleet.',
  truckStatus: 'Choose a truck status.',
  role: 'Choose a role.'
};

export class AppError extends Error {
  constructor(status, body, headers = {}) {
    super(body.message ?? body.error);
    this.name = 'AppError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const badRequest = (message) => new AppError(400, { error: 'bad_request', message });
export const unauthenticated = () => new AppError(401, { error: 'unauthenticated' });
export const invalidCredentials = () =>
  new AppError(401, { error: 'invalid_credentials', message: COPY.invalidCredentials });
export const rateLimited = (retryAfterSeconds) =>
  new AppError(429, { error: 'rate_limited', message: COPY.rateLimited }, { 'Retry-After': String(retryAfterSeconds) });
export const forbidden = () => new AppError(403, { error: 'forbidden', message: COPY.accessRefused });
export const notFound = () => new AppError(404, { error: 'not_found' });
export const conflict = (message) => new AppError(409, { error: 'conflict', message });
export const tooLarge = () => new AppError(413, { error: 'too_large', message: COPY.tooLarge });
export const unsupportedMediaType = () =>
  new AppError(415, { error: 'unsupported_media_type', message: COPY.unsupportedMediaType });
export const validationFailed = (fields) => new AppError(422, { error: 'validation', fields });
export const unavailable = () => new AppError(503, { error: 'unavailable', message: COPY.unavailable });
