import { displayCompact } from './json';
import { fromJson } from './values';
import { ValidationRule, Validator, validationMessage } from './validator';

/** The one set of document messages, used in Save status and in load reports. */
export function documentMessage(
  code: string,
  extras: Record<string, unknown>,
  validator: Validator | null,
): string | null {
  switch (code) {
    case 'invalid_id':
      return 'invalid _id';
    case 'invalid_field_name':
      return `invalid field name at ${String(extras['path'])}`;
    case 'document_too_large':
      return `document is larger than ${String(extras['limit'])} bytes`;
    case 'document_too_deep':
      return `document is nested deeper than ${String(extras['limit'])} levels`;
    case 'validation_failed':
      return validationMessage(String(extras['path']), extras['rule'] as ValidationRule, validator);
    case 'duplicate_key':
      return `Duplicate value ${displayCompact(fromJson(extras['value']))} for unique index ${String(extras['index'])}`;
    default:
      return null;
  }
}

export const NOT_VALID_JSON = 'not valid JSON';
export const NOT_AN_OBJECT = 'not an object';
export const MISSING_HEADER_ROW = 'missing header row';
export const cellCountMessage = (cells: number, headers: number): string =>
  `row has ${cells} cells, header has ${headers}`;
export const duplicateHeaderMessage = (header: string): string => `duplicate header ${header}`;
export const conflictingHeaderMessage = (header: string): string => `conflicting header ${header}`;
