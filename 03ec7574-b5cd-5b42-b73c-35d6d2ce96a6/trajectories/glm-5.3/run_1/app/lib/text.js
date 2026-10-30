import { ApiError } from './http.js';

// Text handling: NFC normalisation, code-point measurement after NFC, control
// character refusal, and the single case folding used for wallet name
// uniqueness.
export function nfc(s) {
  return s.normalize('NFC');
}

export function cpLength(s) {
  return [...s].length;
}

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function checkControl(s, field, message = 'Remove control characters from this field') {
  if (CONTROL_RE.test(s)) throw new ApiError(422, 'VALIDATION_ERROR', message, { field });
}

// Single place for text-field rules: normalise, optionally trim, refuse
// control characters and measure code points after NFC.
export function textField(value, { field, min = 1, max = 60, trim = true, message }) {
  if (typeof value !== 'string') {
    throw new ApiError(422, 'VALIDATION_ERROR', message || `Enter a valid ${field}`, { field });
  }
  let s = nfc(value);
  if (trim) s = s.trim();
  if (CONTROL_RE.test(s)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Remove control characters from this field', { field });
  }
  const len = cpLength(s);
  if (len < min || len > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', message || `Enter between ${min} and ${max} characters`, { field });
  }
  return s;
}

// Unicode default case folding, covering the ß expansion the brief names.
export function caseFold(s) {
  return s.normalize('NFC').toLowerCase().replace(/ß/g, 'ss');
}
