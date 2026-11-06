import { AddressError, normaliseAddress } from '../domain/address.js';
import { AmountError, parseAmount } from '../domain/amounts.js';
import { checkText } from '../domain/text.js';
import { ApiError } from './errors.js';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks the body against the route's shape and refuses the first key the route does not define. */
export function ensureKnownFields(body, schema, prefix = '') {
  if (!isPlainObject(body)) return;
  for (const key of Object.keys(body)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const allowed = schema[key];
    if (allowed === undefined) throw new ApiError('UNKNOWN_FIELD', { details: { field: path } });
    if (allowed === true) continue;
    const value = body[key];
    if (Array.isArray(allowed)) {
      if (!Array.isArray(value)) continue;
      value.forEach((entry, index) => ensureKnownFields(entry, allowed[0], `${path}.${index}`));
      continue;
    }
    ensureKnownFields(value, allowed, path);
  }
}

export function validationError(field) {
  return new ApiError('VALIDATION_ERROR', { details: { field } });
}

export function requireText(value, limitName, field, { trim = false } = {}) {
  const checked = checkText(value, limitName, { trim });
  if (!checked.ok) throw validationError(field);
  return checked.value;
}

export function requireEnum(value, options, field) {
  if (!options.includes(value)) throw validationError(field);
  return value;
}

export function requireInteger(value, field, { min, max }) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw validationError(field);
  return value;
}

export function requireAmount(value, asset, field, { allowZero = false } = {}) {
  try {
    return parseAmount(value, asset, { allowZero });
  } catch (error) {
    if (error instanceof AmountError) throw new ApiError(error.code, { details: { field } });
    throw error;
  }
}

export function requireAddress(value, field, details = {}) {
  try {
    return normaliseAddress(value);
  } catch (error) {
    if (error instanceof AddressError) throw new ApiError(error.code, { details: { ...details, field } });
    throw error;
  }
}

export function requireIdString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) throw validationError(field);
  return value;
}
