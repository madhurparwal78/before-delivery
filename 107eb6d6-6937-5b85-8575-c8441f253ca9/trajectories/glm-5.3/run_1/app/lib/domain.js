'use strict';

// The single source of every domain label, validation rule and error copy.
const LABELS = {
  tour: 'Tour', show: 'Show', show_freight: 'Show freight',
  submitted: 'Submitted', confirmed: 'Confirmed', declined: 'Declined',
  available: 'Available', assigned: 'Assigned', maintenance: 'Maintenance',
  north: 'North', south: 'South',
  admin: 'Admin', dispatcher: 'Dispatcher', tour_manager: 'Tour manager',
};

const STOP_KINDS = ['pickup', 'delivery', 'first_show', 'last_show'];
const STOP_KIND_LABELS = { pickup: 'Pickup', delivery: 'Delivery', first_show: 'First Show', last_show: 'Last Show' };
const TRUCK_STATUS = ['available', 'assigned', 'maintenance'];
const REQUEST_STATUSES = ['submitted', 'confirmed', 'declined'];
const TRANSPORT_TYPES = ['tour', 'show', 'show_freight'];

const FIELD_REASONS = {
  tour_name: {
    required: 'Tour name is required.',
    tooLong: 'Tour name must be 80 characters or fewer.',
  },
  transport_type: { required: 'Choose a type of transportation.' },
  trucks_requested: { required: 'Enter a number of trucks from 1 to 8.', range: 'Enter a number of trucks from 1 to 8.' },
  address: { required: 'Address is required.' },
  city: { required: 'City is required.' },
  region: { required: 'State or province is required.' },
  postal_code: { required: 'Postal code is required.' },
  country: { required: 'Country is required.' },
  date: { required: 'Enter a valid date.', invalid: 'Enter a valid date.' },
  stops: {
    deliveryBeforePickup: 'Delivery cannot be before pickup.',
    lastShowBeforeFirstShow: 'Last show cannot be before the first show.',
  },
  notes: { tooLong: 'Notes must be 500 characters or fewer.' },
  decision: { required: 'Choose a decision.' },
  note: {
    required: 'Add a note to explain your decision.',
    tooLong: 'Note must be 500 characters or fewer.',
  },
  truck_id: { required: 'Choose a truck from the fleet.' },
  draft_id: { required: 'The draft id must be a UUID.' },
  role: { required: 'Choose a role.' },
};

const STATUS_BAD_REQUEST = {
  request: 'status must be submitted, confirmed or declined.',
  truck: 'status must be available, assigned or maintenance.',
};
const LIMIT_BAD_REQUEST = 'limit must be a whole number from 1 to 100.';
const CURSOR_BAD_REQUEST = 'cursor is not valid.';
const ACCESS_REFUSED = 'You do not have access to this page.';
const LOCKOUT_SECONDS = () => {
  const raw = parseInt(process.env.SIGN_IN_LOCKOUT_SECONDS, 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 900;
};

const DECIDED_CONFLICT = 'This request has already been decided.';
const TRUCK_UNAVAILABLE_CONFLICT = 'This truck is not available.';
const FULL_REQUEST_CONFLICT = 'This request already has every truck it asked for.';
const TRUCK_ON_REQUEST_CONFLICT = 'This truck is on a request.';
const EARLY_CONFIRM_CONFLICT = 'Assign every requested truck before confirming.';
const LAST_ADMIN_CONFLICT = 'At least one admin is required.';
const UNAVAILABLE_MESSAGE = 'The desk cannot reach its records right now. Try again shortly.';
const INVALID_CREDENTIALS = { error: 'invalid_credentials', message: 'Invalid email or password.' };
const LOCKED_OUT = { error: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' };

const STOP_FIELD_REASONS = {
  address: FIELD_REASONS.address.required,
  city: FIELD_REASONS.city.required,
  region: FIELD_REASONS.region.required,
  postal_code: FIELD_REASONS.postal_code.required,
  country: FIELD_REASONS.country.required,
};

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = {
  LABELS, STOP_KINDS, STOP_KIND_LABELS, TRUCK_STATUS, REQUEST_STATUSES,
  TRANSPORT_TYPES, FIELD_REASONS, STOP_FIELD_REASONS, STATUS_BAD_REQUEST,
  LIMIT_BAD_REQUEST, CURSOR_BAD_REQUEST, ACCESS_REFUSED,
  DECIDED_CONFLICT, TRUCK_UNAVAILABLE_CONFLICT,
  FULL_REQUEST_CONFLICT, TRUCK_ON_REQUEST_CONFLICT, EARLY_CONFIRM_CONFLICT,
  LAST_ADMIN_CONFLICT, UNAVAILABLE_MESSAGE, INVALID_CREDENTIALS, LOCKED_OUT,
  LOCKOUT_SECONDS, isValidDate,
};
