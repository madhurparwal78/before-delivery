'use strict';

// Validation lives here only: every 422 with its field reasons comes from this module.
const {
  TRANSPORT_TYPES, STOP_KINDS, STOP_FIELD_REASONS, FIELD_REASONS, isValidDate,
} = require('./domain');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REJECTED = 'rejected';

function stopErrors(stop, isPresent) {
  const errors = {};
  if (!isPresent || typeof stop !== 'object' || Array.isArray(stop)) {
    errors.kind = 'missing';
    return errors;
  }
  const trimmed = {
    date: typeof stop.date === 'string' ? stop.date.trim() : (stop.date == null ? '' : stop.date),
    address: typeof stop.address === 'string' ? stop.address.trim() : null,
    city: typeof stop.city === 'string' ? stop.city.trim() : null,
    region: typeof stop.region === 'string' ? stop.region.trim() : null,
    postal_code: typeof stop.postal_code === 'string' ? stop.postal_code.trim() : null,
    country: typeof stop.country === 'string' ? stop.country.trim() : null,
  };
  for (const field of ['address', 'city', 'region', 'postal_code', 'country']) {
    if (!trimmed[field]) errors[field] = STOP_FIELD_REASONS[field];
  }
  if (trimmed.date) {
    if (!isValidDate(trimmed.date)) errors.date = FIELD_REASONS.date.invalid;
  }
  return errors;
}

function dateValue(stop) {
  return (typeof stop === 'object' && stop && typeof stop.date === 'string')
    ? stop.date.trim() : null;
}

// A malformed draft id is decided on its own, before any other check.
function validateDraftId(draftId) {
  if (draftId == null) return null;
  if (typeof draftId !== 'string' || !UUID_RE.test(draftId.trim())) {
    return FIELD_REASONS.draft_id.required;
  }
  return null;
}

function validateRequestDraft(body) {
  const errors = {};
  const normalized = {};
  const source = typeof body === 'object' && body && !Array.isArray(body) ? body : {};

  const tourName = typeof source.tour_name === 'string' ? source.tour_name.trim() : '';
  if (!tourName) errors.tour_name = FIELD_REASONS.tour_name.required;
  else if (tourName.length > 80) errors.tour_name = FIELD_REASONS.tour_name.tooLong;
  normalized.tour_name = tourName;

  const type = source.transport_type;
  if (!TRANSPORT_TYPES.includes(type)) errors.transport_type = FIELD_REASONS.transport_type.required;
  normalized.transport_type = type;

  const count = source.trucks_requested;
  if (Number.isInteger(count) && count >= 1 && count <= 8) normalized.trucks_requested = count;
  else errors.trucks_requested = FIELD_REASONS.trucks_requested.range;

  normalized.stops = {};
  const stopsObj = source.stops;
  for (const kind of STOP_KINDS) {
    const present = stopsObj && typeof stopsObj === 'object' && !Array.isArray(stopsObj) && Object.prototype.hasOwnProperty.call(stopsObj, kind);
    const stopFieldErrors = stopErrors(stopsObj ? stopsObj[kind] : null, present);
    for (const [field, reason] of Object.entries(stopFieldErrors)) {
      errors[field === 'kind' ? `stops.${kind}` : `stops.${kind}.${field}`] = reason;
    }
    normalized.stops[kind] = present && typeof stopsObj[kind] === 'object' && !Array.isArray(stopsObj[kind])
      ? {
          date: dateValue(stopsObj[kind]) || null,
          address: stopsObj[kind].address,
          city: stopsObj[kind].city,
          region: stopsObj[kind].region,
          postal_code: stopsObj[kind].postal_code,
          country: stopsObj[kind].country,
        }
      : null;
  }

  const pickupDate = dateValue(normalized.stops.pickup);
  const deliveryDate = dateValue(normalized.stops.delivery);
  if (pickupDate && deliveryDate && !errors['stops.delivery.date'] && deliveryDate < pickupDate) {
    errors['stops.delivery.date'] = FIELD_REASONS.stops.deliveryBeforePickup;
  }
  const firstShowDate = dateValue(normalized.stops.first_show);
  const lastShowDate = dateValue(normalized.stops.last_show);
  if (firstShowDate && lastShowDate && !errors['stops.last_show.date'] && lastShowDate < firstShowDate) {
    errors['stops.last_show.date'] = FIELD_REASONS.stops.lastShowBeforeFirstShow;
  }

  const notes = typeof source.notes === 'string' ? source.notes.trim() : '';
  if (notes.length > 500) errors.notes = FIELD_REASONS.notes.tooLong;
  normalized.notes = notes;

  const draftId = source.draft_id;
  if (draftId != null) {
    if (typeof draftId !== 'string' || !UUID_RE.test(draftId.trim())) {
      errors.draft_id = FIELD_REASONS.draft_id.required;
    } else {
      normalized.draft_id = draftId.trim().toLowerCase();
    }
  }

  if (Object.keys(errors).length > 0) return { [REJECTED]: true, fields: errors };
  const stops = {};
  for (const kind of STOP_KINDS) {
    stops[kind] = {
      date: normalized.stops[kind].date,
      address: normalized.stops[kind].address.trim(),
      city: normalized.stops[kind].city.trim(),
      region: normalized.stops[kind].region.trim(),
      postal_code: normalized.stops[kind].postal_code.trim(),
      country: normalized.stops[kind].country.trim(),
    };
  }
  return {
    tour_name: normalized.tour_name,
    transport_type: normalized.transport_type,
    trucks_requested: normalized.trucks_requested,
    notes: normalized.notes,
    draft_id: normalized.draft_id || null,
    stops,
  };
}

function validateDecision(body) {
  const errors = {};
  const source = typeof body === 'object' && body && !Array.isArray(body) ? body : {};
  const decision = source.decision;
  if (decision !== 'confirm' && decision !== 'decline') errors.decision = FIELD_REASONS.decision.required;
  const note = typeof source.note === 'string' ? source.note.trim() : '';
  if (!note) errors.note = FIELD_REASONS.note.required;
  else if (note.length > 500) errors.note = FIELD_REASONS.note.tooLong;
  if (Object.keys(errors).length > 0) return { [REJECTED]: true, fields: errors };
  return { decision, note };
}

function validateTruckId(body) {
  const source = typeof body === 'object' && body && !Array.isArray(body) ? body : {};
  const truckId = source.truck_id;
  if (typeof truckId !== 'string' || !/^TR-\d{3}$/.test(truckId.trim())) {
    return { [REJECTED]: true, fields: { truck_id: FIELD_REASONS.truck_id.required } };
  }
  return { truck_id: truckId.trim() };
}

function validateRole(body) {
  const source = typeof body === 'object' && body && !Array.isArray(body) ? body : {};
  const role = source.role;
  if (!['admin', 'dispatcher', 'tour_manager'].includes(role)) {
    return { [REJECTED]: true, fields: { role: FIELD_REASONS.role.required } };
  }
  return { role };
}

function validateTruckStatus(body) {
  const source = typeof body === 'object' && body && !Array.isArray(body) ? body : {};
  const status = source.status;
  if (status !== 'available' && status !== 'maintenance') return null;
  return status;
}

module.exports = { validateRequestDraft, validateDraftId, validateDecision, validateTruckId, validateRole, validateTruckStatus, REJECTED };
