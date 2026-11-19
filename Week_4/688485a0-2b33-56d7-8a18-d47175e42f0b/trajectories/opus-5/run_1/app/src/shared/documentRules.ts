import { documentTooDeep, documentTooLarge, invalidFieldName, invalidId } from './errors';
import { compactJson, orderDocument, utf8Length } from './json';
import { DocObject, DocValue, isPlainObject } from './values';

export const ID_PATTERN = /^[0-9a-f]{24}$/;

export interface DocumentLimits {
  maxBytes: number;
  maxDepth: number;
}

export function isValidDocumentId(value: DocValue): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function checkFieldNames(value: DocValue, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkFieldNames(item, path ? `${path}.${index}` : String(index)));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key.startsWith('$') || key.includes('.')) throw invalidFieldName(childPath);
    checkFieldNames(value[key], childPath);
  }
}

export function documentDepth(value: DocValue): number {
  if (Array.isArray(value)) {
    let deepest = 0;
    for (const item of value) deepest = Math.max(deepest, documentDepth(item));
    return 1 + deepest;
  }
  if (isPlainObject(value)) {
    let deepest = 0;
    for (const key of Object.keys(value)) deepest = Math.max(deepest, documentDepth(value[key]));
    return 1 + deepest;
  }
  return 0;
}

export function documentSize(doc: DocObject): number {
  return utf8Length(compactJson(orderDocument(doc)));
}

/** The document check order: `_id`, field names, size, then depth. */
export function checkDocumentShape(doc: DocObject, limits: DocumentLimits): void {
  if (Object.prototype.hasOwnProperty.call(doc, '_id') && !isValidDocumentId(doc['_id'])) throw invalidId();
  checkFieldNames(doc, '');
  if (documentSize(doc) > limits.maxBytes) throw documentTooLarge(limits.maxBytes);
  if (documentDepth(doc) > limits.maxDepth) throw documentTooDeep(limits.maxDepth);
}
