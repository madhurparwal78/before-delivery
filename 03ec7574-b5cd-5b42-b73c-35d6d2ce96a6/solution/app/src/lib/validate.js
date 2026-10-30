import { ADDRESS_MESSAGES, ApiError, readAddress } from './core.js';

// Request body checks. Callers check unknown keys over the whole body first, then read each field in
// the route's pinned order, so the first offending field in that order is the one reported.

export function fail(field, message, extra = {}) {
  throw new ApiError(422, 'VALIDATION_ERROR', message, { ...extra, field });
}

export function objectBody(raw) {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('body', 'The request body must be a JSON object.');
  return raw;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// shape: { key: true } for a leaf, { key: { ...shape } } for an object, { key: [shape] } for a list of objects.
export function unknown(body, shape, prefix = '') {
  if (!isObject(body)) return;
  for (const key of Object.keys(body)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(shape, key)) {
      throw new ApiError(422, 'UNKNOWN_FIELD', `The field ${path} is not part of this request.`, { field: path });
    }
    const inner = shape[key];
    const value = body[key];
    if (Array.isArray(inner) && Array.isArray(value)) value.forEach((item, i) => unknown(item, inner[0], `${path}.${i}`));
    else if (isObject(inner)) unknown(value, inner, path);
  }
}

export const present = (body, key) => Object.hasOwn(body, key) && body[key] !== undefined;

// A route that takes no body accepts an empty body or {}.
export function noFields(raw) {
  unknown(objectBody(raw), {});
}

// Line breaks count as control characters; only the contact message allows line feeds.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_BUT_LF = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

export const codePoints = (value) => [...value].length;
export const hasControl = (value) => CONTROL.test(value);

// Unicode default case folding, applied after NFC: names that fold alike are the same name.
export function fold(value) {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

// A text field: NFC, optionally trimmed, no control characters, measured in code points.
export function text(body, key, {
  min = 1, max, trim = false, optional = false, field = key, label = key, lines = false,
  nonBlank = false, message, controlMessage, extra = {},
} = {}) {
  const sizeMessage = message || `${label} must be ${min} to ${max} characters.`;
  if (!present(body, key)) {
    if (optional) return undefined;
    fail(field, message || `${label} is required.`, extra);
  }
  if (typeof body[key] !== 'string') fail(field, message || `${label} must be text.`, extra);
  let value = body[key].normalize('NFC');
  if (lines) value = value.replace(/\r\n/g, '\n');
  if (trim) value = value.trim();
  if ((lines ? CONTROL_BUT_LF : CONTROL).test(value)) {
    fail(field, controlMessage || `${label} may not contain control characters or line breaks.`, extra);
  }
  const length = codePoints(value);
  if (length < min || length > max || (nonBlank && !value.trim())) fail(field, sizeMessage, extra);
  return value;
}

export function choice(body, key, values, { optional = false, field = key, label = key, message } = {}) {
  if (!present(body, key)) {
    if (optional) return undefined;
    fail(field, message || `${label} is required.`);
  }
  if (typeof body[key] !== 'string' || !values.includes(body[key])) {
    fail(field, message || `${label} must be one of ${values.join(', ')}.`);
  }
  return body[key];
}

export function integer(body, key, { min, max, optional = false, field = key, label = key } = {}) {
  if (!present(body, key)) {
    if (optional) return undefined;
    fail(field, `${label} is required.`);
  }
  const value = body[key];
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(field, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

// A missing address is VALIDATION_ERROR; a malformed one INVALID_ADDRESS; a wrong mixed case INVALID_ADDRESS_CHECKSUM.
export function address(body, key, { field = key, extra = {} } = {}) {
  if (!present(body, key)) fail(field, `${key} is required.`, extra);
  const read = readAddress(body[key]);
  if (read.code !== 'ok') throw new ApiError(422, read.code, ADDRESS_MESSAGES[read.code], { ...extra, field });
  return read.address;
}

// A nullable id of another row: undefined when absent, null when detached.
export function ref(body, key) {
  if (!present(body, key)) return undefined;
  if (body[key] === null) return null;
  if (typeof body[key] !== 'string' || !body[key]) fail(key, `${key} must be an id or null.`);
  return body[key];
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
