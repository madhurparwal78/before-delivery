'use strict';

// The one text-input rule, the one code-point length rule, the one amount rule
// and the one id well-formedness rule.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CONTROLS_SINGLE_LINE = /[\u0001-\u001F\u007F]/;
const CONTROLS_MULTI_LINE = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DIRECTION_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;
const ASCII_DIGITS_ONLY = /^[0-9]+$/;
const ID_FORM = /^[0-9a-f]{32}$/;

const MAX_AMOUNT_CENTS = 9007199254740991;

function codePointLength(value) {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// Refused everywhere: NUL and unpaired surrogates.
function hasForbiddenEverywhere(value) {
  return value.includes('\u0000') || LONE_SURROGATE.test(value);
}

function isWellFormedId(value) {
  return typeof value === 'string' && ID_FORM.test(value);
}

class FieldErrors {
  constructor() {
    this.fields = {};
  }

  add(field, message) {
    if (!(field in this.fields)) this.fields[field] = message;
    return this;
  }

  get any() {
    return Object.keys(this.fields).length > 0;
  }
}

// A string value a body key reads, on a single-line field.
function readSingleLine(raw, { trim = true } = {}) {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter text' };
  if (hasForbiddenEverywhere(raw)) return { ok: false, message: 'Remove unsupported characters' };
  if (CONTROLS_SINGLE_LINE.test(raw) || DIRECTION_CONTROLS.test(raw)) {
    return { ok: false, message: 'Remove control or direction characters from this name' };
  }
  const value = trim ? raw.trim() : raw;
  return { ok: true, value };
}

// A string value a body key reads, on a multi-line field.
function readMultiLine(raw, { trim = true } = {}) {
  if (typeof raw !== 'string') return { ok: false, message: 'Enter text' };
  if (hasForbiddenEverywhere(raw)) return { ok: false, message: 'Remove unsupported characters' };
  if (CONTROLS_MULTI_LINE.test(raw)) return { ok: false, message: 'Remove control characters' };
  const value = trim ? raw.trim() : raw;
  return { ok: true, value };
}

// Every amount_cents in a request: a plain positive integer in range.
function isValidAmountCents(raw) {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_AMOUNT_CENTS;
}

function isAsciiDigits(value) {
  return typeof value === 'string' && ASCII_DIGITS_ONLY.test(value);
}

// The ABA checksum: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) is a multiple of 10.
function isValidRoutingNumber(value) {
  if (!isAsciiDigits(value) || value.length !== 9) return false;
  const d = [...value].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const EMAIL_LOCAL_MAX = 254;

function readEmail(raw) {
  const single = readSingleLine(raw);
  if (!single.ok) return { ok: false, message: 'Enter a valid email' };
  const value = single.value.toLowerCase();
  if (codePointLength(value) < 3 || codePointLength(value) > EMAIL_LOCAL_MAX) {
    return { ok: false, message: 'Enter a valid email' };
  }
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return { ok: false, message: 'Enter a valid email' };
  const domain = value.slice(at + 1);
  if (!domain.includes('.') || /\s/.test(domain) || domain.startsWith('.') || domain.endsWith('.')) {
    return { ok: false, message: 'Enter a valid email' };
  }
  return { ok: true, value };
}

module.exports = {
  MAX_AMOUNT_CENTS,
  FieldErrors,
  codePointLength,
  hasForbiddenEverywhere,
  isWellFormedId,
  readSingleLine,
  readMultiLine,
  readEmail,
  isValidAmountCents,
  isAsciiDigits,
  isValidRoutingNumber,
};
