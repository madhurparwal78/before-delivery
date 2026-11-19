'use strict';

// RFC 4180 CSV, with the one formula-neutralisation rule. A counterparty or
// memo can never run as a spreadsheet formula; amounts stay plain numbers.

const NEUTRALISE_FIRST = new Set(['=', '+', '-', '@', '\u0009', '\u000D']);

function neutralise(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length > 0 && NEUTRALISE_FIRST.has(text[0])) return `'${text}`;
  return text;
}

function quote(field) {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

function textCell(value) {
  return quote(neutralise(value));
}

function plainCell(value) {
  return quote(value === null || value === undefined ? '' : String(value));
}

module.exports = { neutralise, textCell, plainCell };
