'use strict';
// Every word the desk says about its records: the labels, the field reasons, the
// refusal copy and the one error shape every API refusal is built from.

const LABELS = Object.freeze({
  status: { submitted: 'Submitted', confirmed: 'Confirmed', declined: 'Declined' },
  type: { tour: 'Tour', show: 'Show', show_freight: 'Show freight' },
  role: { admin: 'Admin', dispatcher: 'Dispatcher', tour_manager: 'Tour manager' },
  truck: { available: 'Available', assigned: 'Assigned', maintenance: 'Maintenance' },
  depot: { north: 'North', south: 'South' },
  stop: { pickup: 'Pickup', delivery: 'Delivery', first_show: 'First Show', last_show: 'Last Show' },
});

const COPY = Object.freeze({
  invalidCredentials: 'Invalid email or password.',
  rateLimited: 'Too many sign-in attempts. Try again later.',
  forbidden: 'You do not have access to this page.',
  missingRequest: 'This request does not exist or you cannot see it.',
  wrongVenue: '404. Wrong venue.',
  wrongVenueLine: 'This address is not on the run sheet.',
  unavailable: 'The desk cannot reach its records right now. Try again shortly.',
  badJson: 'Request body is not valid JSON.',
  tooLarge: 'Request body is too large.',
  unsupportedMedia: 'Send the body as application/json.',
  badRequestStatus: 'status must be submitted, confirmed or declined.',
  badTruckStatus: 'status must be available, assigned or maintenance.',
  badLimit: 'limit must be a whole number from 1 to 100.',
  badCursor: 'cursor is not valid.',
  decided: 'This request has already been decided.',
  truckUnavailable: 'This truck is not available.',
  requestFull: 'This request already has every truck it asked for.',
  confirmEarly: 'Assign every requested truck before confirming.',
  truckOnRequest: 'This truck is on a request.',
  lastAdmin: 'At least one admin is required.',
});

const FIELD = Object.freeze({
  tourRequired: 'Tour name is required.',
  tourTooLong: 'Tour name must be 80 characters or fewer.',
  typeRequired: 'Choose a type of transportation.',
  trucksRange: 'Enter a number of trucks from 1 to 8.',
  address: 'Address is required.',
  city: 'City is required.',
  region: 'State or province is required.',
  postal_code: 'Postal code is required.',
  country: 'Country is required.',
  date: 'Enter a valid date.',
  deliveryEarly: 'Delivery cannot be before pickup.',
  lastShowEarly: 'Last show cannot be before the first show.',
  notesTooLong: 'Notes must be 500 characters or fewer.',
  noteRequired: 'Add a note to explain your decision.',
  noteTooLong: 'Note must be 500 characters or fewer.',
  truckUnknown: 'Choose a truck from the fleet.',
  role: 'Choose a role.',
});

// Field reasons the brief does not word: a missing stop, a bad decision word, a
// truck status outside the two an admin may set, and a malformed draft id.
const FIELD_OTHER = Object.freeze({
  stopMissing: (kind) => `Add the ${LABELS.stop[kind]} stop.`,
  decision: 'Choose Confirm or Decline.',
  truckStatus: 'Choose available or maintenance.',
  draftId: 'The draft id must be a UUID.',
});

class AppError extends Error {
  constructor(status, body, headers = {}) {
    super(body.message || body.error);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const refuse = {
  badRequest: (message) => new AppError(400, { error: 'bad_request', message }),
  unauthenticated: () => new AppError(401, { error: 'unauthenticated' }),
  invalidCredentials: () => new AppError(401, { error: 'invalid_credentials', message: COPY.invalidCredentials }),
  forbidden: () => new AppError(403, { error: 'forbidden', message: COPY.forbidden }),
  notFound: () => new AppError(404, { error: 'not_found' }),
  conflict: (message) => new AppError(409, { error: 'conflict', message }),
  tooLarge: () => new AppError(413, { error: 'too_large', message: COPY.tooLarge }),
  unsupportedMedia: () => new AppError(415, { error: 'unsupported_media_type', message: COPY.unsupportedMedia }),
  validation: (fields) => new AppError(422, { error: 'validation', fields }),
  rateLimited: (retryAfter) => new AppError(429, { error: 'rate_limited', message: COPY.rateLimited },
    { 'Retry-After': String(retryAfter) }),
  unavailable: () => new AppError(503, { error: 'unavailable', message: COPY.unavailable }),
};

module.exports = { LABELS, COPY, FIELD, FIELD_OTHER, AppError, refuse };
