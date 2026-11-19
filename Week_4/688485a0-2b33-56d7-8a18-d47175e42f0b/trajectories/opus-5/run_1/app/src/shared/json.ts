import { numberText, displayNumber } from './numbers';
import { DocDate, DocObject, DocValue, isPlainObject } from './values';

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

/** Compact JSON text of a document value: no whitespace, numbers in their shortest text. */
export function compactJson(value: DocValue): string {
  if (value === null) return 'null';
  if (value instanceof DocDate) return `{"$date":${quote(value.text())}}`;
  if (Array.isArray(value)) return `[${value.map(compactJson).join(',')}]`;
  if (isPlainObject(value)) {
    const parts = Object.keys(value).map((key) => `${quote(key)}:${compactJson(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'string') return quote(value);
  return value ? 'true' : 'false';
}

/** Pretty JSON text with two-space indents, keeping field order. */
export function prettyJson(value: DocValue, indent = 0): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => inner + prettyJson(item, indent + 2));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const items = keys.map((key) => `${inner}${quote(key)}: ${prettyJson(value[key], indent + 2)}`);
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return compactJson(value);
}

/** The single display rule for lists, tables, previews and counts. */
export function displayValue(value: DocValue): string {
  if (value === null) return 'null';
  if (value instanceof DocDate) return value.text();
  if (typeof value === 'number') return displayNumber(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return displayCompact(value);
}

/** Compact JSON for screens: numbers follow the display rule. */
export function displayCompact(value: DocValue): string {
  if (value === null) return 'null';
  if (value instanceof DocDate) return `{"$date":${quote(value.text())}}`;
  if (Array.isArray(value)) return `[${value.map(displayCompact).join(',')}]`;
  if (isPlainObject(value)) {
    const parts = Object.keys(value).map((key) => `${quote(key)}:${displayCompact(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  if (typeof value === 'number') return displayNumber(value);
  if (typeof value === 'string') return quote(value);
  return value ? 'true' : 'false';
}

/** Pretty JSON for the JSON results view: numbers follow the display rule. */
export function displayPretty(value: DocValue, indent = 0): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => inner + displayPretty(item, indent + 2)).join(',\n')}\n${pad}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const items = keys.map((key) => `${inner}${quote(key)}: ${displayPretty(value[key], indent + 2)}`);
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return displayCompact(value);
}

/** Puts `_id` first, keeping every other field in its order. */
export function orderDocument(doc: DocObject): DocObject {
  const out: DocObject = {};
  if (Object.prototype.hasOwnProperty.call(doc, '_id')) out['_id'] = doc['_id'];
  for (const key of Object.keys(doc)) {
    if (key !== '_id') out[key] = doc[key];
  }
  return out;
}
