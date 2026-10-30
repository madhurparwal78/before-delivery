import { FIELD_REASONS, badRequest, validationFailed, COPY } from './errors.js';
import { REQUEST_STATUSES, ROLES, STOP_KINDS, TRANSPORT_TYPES, TRUCK_STATUSES } from './labels.js';
import { config } from '../config.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STOP_TEXT_FIELDS = [
  ['address', FIELD_REASONS.address],
  ['city', FIELD_REASONS.city],
  ['region', FIELD_REASONS.region],
  ['postal_code', FIELD_REASONS.postalCode],
  ['country', FIELD_REASONS.country]
];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const isCalendarDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
};

const wholeNumber = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return null;
};

export function collectTourDetails(body) {
  const fields = {};
  const tourName = text(body?.tour_name);
  if (!tourName) fields.tour_name = FIELD_REASONS.tourNameRequired;
  else if (tourName.length > 80) fields.tour_name = FIELD_REASONS.tourNameLength;

  const transportType = text(body?.transport_type);
  if (!TRANSPORT_TYPES.includes(transportType)) fields.transport_type = FIELD_REASONS.transportType;

  const trucksRequested = wholeNumber(body?.trucks_requested);
  if (trucksRequested === null || trucksRequested < 1 || trucksRequested > 8) {
    fields.trucks_requested = FIELD_REASONS.trucksRequested;
  }

  return {
    fields,
    value: {
      tour_name: tourName,
      transport_type: transportType,
      trucks_requested: trucksRequested
    }
  };
}

export function collectStops(body) {
  const fields = {};
  const value = {};

  for (const kind of STOP_KINDS) {
    const raw = body?.stops?.[kind];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fields[`stops.${kind}`] = FIELD_REASONS.stopMissing;
      value[kind] = { kind, date: null, address: '', city: '', region: '', postal_code: '', country: '' };
      continue;
    }

    const stop = { kind, date: null };
    for (const [field, reason] of STOP_TEXT_FIELDS) {
      const entry = text(raw[field]);
      if (!entry) fields[`stops.${kind}.${field}`] = reason;
      stop[field] = entry;
    }

    const date = text(raw.date);
    if (date) {
      if (isCalendarDate(date)) stop.date = date;
      else fields[`stops.${kind}.date`] = FIELD_REASONS.date;
    }
    value[kind] = stop;
  }

  const { pickup, delivery, first_show: firstShow, last_show: lastShow } = value;
  if (pickup.date && delivery.date && delivery.date < pickup.date) {
    fields['stops.delivery.date'] = FIELD_REASONS.deliveryBeforePickup;
  }
  if (firstShow.date && lastShow.date && lastShow.date < firstShow.date) {
    fields['stops.last_show.date'] = FIELD_REASONS.lastShowBeforeFirst;
  }

  return { fields, value };
}

function collectNotes(body) {
  const notes = text(body?.notes);
  if (notes.length > 500) return { fields: { notes: FIELD_REASONS.notesLength }, value: null };
  return { fields: {}, value: notes || null };
}

export function parseDraftId(body) {
  const raw = body?.draft_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw.trim())) {
    throw validationFailed({ draft_id: FIELD_REASONS.draftId });
  }
  return raw.trim().toLowerCase();
}

export function buildNewRequest(body) {
  const details = collectTourDetails(body);
  const stops = collectStops(body);
  const notes = collectNotes(body);
  const fields = { ...details.fields, ...stops.fields, ...notes.fields };
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return {
    ...details.value,
    notes: notes.value,
    stops: STOP_KINDS.map((kind) => stops.value[kind])
  };
}

export function buildDecision(body) {
  const fields = {};
  const decision = text(body?.decision);
  if (decision !== 'confirm' && decision !== 'decline') fields.decision = FIELD_REASONS.decision;

  const note = text(body?.note);
  if (!note) fields.note = FIELD_REASONS.noteRequired;
  else if (note.length > 500) fields.note = FIELD_REASONS.noteLength;

  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { decision, note };
}

export function buildTruckId(body) {
  const truckId = text(body?.truck_id);
  if (!truckId) throw validationFailed({ truck_id: FIELD_REASONS.truckId });
  return truckId;
}

export function buildTruckStatus(body) {
  const status = text(body?.status);
  if (status !== 'available' && status !== 'maintenance') {
    throw validationFailed({ status: FIELD_REASONS.truckStatus });
  }
  return status;
}

export function buildRole(body) {
  const role = text(body?.role);
  if (!ROLES.includes(role)) throw validationFailed({ role: FIELD_REASONS.role });
  return role;
}

export function parseRequestListQuery(query) {
  const status = text(query?.status);
  if (status && !REQUEST_STATUSES.includes(status)) throw badRequest(COPY.badRequestStatus);

  const rawLimit = query?.limit;
  let limit = config.apiPageSizeDefault;
  if (rawLimit !== undefined && rawLimit !== '') {
    const parsed = wholeNumber(rawLimit);
    if (parsed === null || parsed < 1 || parsed > config.apiPageSizeMax) throw badRequest(COPY.badLimit);
    limit = parsed;
  }

  return {
    status: status || null,
    q: typeof query?.q === 'string' ? query.q.trim() : '',
    limit,
    cursor: text(query?.cursor) || null
  };
}

export function parseTruckStatusQuery(query) {
  const status = text(query?.status);
  if (status && !TRUCK_STATUSES.includes(status)) throw badRequest(COPY.badTruckStatus);
  return status || null;
}
