import { ApiFailure } from './api';
import { displayNumber } from '../shared/numbers';
import { documentMessage } from '../shared/messages';
import { Validator } from '../shared/validator';

/** `<n> document` or `<n> documents`, with every number under the display rule. */
export function documentCount(count: number): string {
  return `${displayNumber(count)} ${count === 1 ? 'document' : 'documents'}`;
}

export const READ_ONLY_NOTE = 'You have read access';
export const EMPTY_COLLECTION = 'NOTHING IN THIS JAR YET';
export const OUTAGE_BANNER = 'File storage is unavailable. Try again later.';
export const CLASH_NOTICE = 'This document was changed by someone else.';
export const DOCUMENT_GONE = 'This document no longer exists';
export const EDITOR_PLACEHOLDER = 'Open a document to see it here';
export const NO_INVITATIONS = 'No invitations';
export const LANDING_LINE = 'Keep, shape and share your JSON documents in one bright jar.';
export const PASS_THROUGH = 'pass through';
export const PIN_STOPS_HERE = 'Pinned document stops here';
export const PIN_REACHES_END = 'Pinned document reaches the end';
export const NAME_TAKEN_QUERY = 'A saved query with this name already exists';

export function queryStatusResult(matched: number, shown: number): string {
  if (matched === 0) return 'No documents matched';
  return `${documentCount(matched)} matched, ${displayNumber(shown)} shown`;
}

export function planLines(kind: 'index' | 'full_scan', index: string | null, examined: number, returned: number): string[] {
  return [
    kind === 'index' ? `Used index ${index ?? ''}` : 'Full scan',
    `Examined ${documentCount(examined)}, returned ${displayNumber(returned)}`,
  ];
}

export function fieldJsonError(field: 'Filter' | 'Projection' | 'Sort'): string {
  return `${field} is not valid JSON`;
}

const QUERY_FIELD_TEXT: Record<string, string> = {
  filter: 'Filter is not valid',
  projection: 'Projection is not valid',
  sort: 'Sort is not valid',
  limit: 'Limit must be a whole number of 0 or more',
  page: 'Page must be a whole number of 1 or more',
};

export function queryErrorText(failure: ApiFailure): string {
  const extras = failure.body;
  switch (failure.code) {
    case 'unknown_operator':
      return `Unknown operator ${String(extras['operator'])}`;
    case 'invalid_projection':
      return 'Projection cannot mix inclusion and exclusion';
    case 'scan_limit':
      return `Query stopped: more than ${displayNumber(Number(extras['limit']))} documents would be scanned. Add an index or narrow the filter.`;
    case 'query_too_deep':
      return `Query is nested deeper than ${displayNumber(Number(extras['limit']))} levels`;
    case 'invalid_query':
      return QUERY_FIELD_TEXT[String(extras['field'])] ?? 'Filter is not valid';
    case 'read_only':
      return READ_ONLY_NOTE;
    case 'not_found':
      return 'Not found';
    default:
      return 'Query is not valid';
  }
}

export function pipelineErrorText(failure: ApiFailure): string {
  const extras = failure.body;
  switch (failure.code) {
    case 'too_many_stages':
      return `Pipeline has more than ${displayNumber(Number(extras['limit']))} stages`;
    case 'unknown_stage':
      return `Unknown stage ${String(extras['stage'])}`;
    case 'invalid_stage':
      return `Stage ${displayNumber(Number(extras['index']) + 1)} is not valid`;
    default:
      return queryErrorText(failure);
  }
}

export function stageStatusText(
  position: number,
  total: number,
  count: number,
  capped: boolean,
  limit: number,
): string {
  if (capped) return `Stage ${displayNumber(position)} of ${displayNumber(total)}: ≤${displayNumber(limit)} documents out`;
  return `Stage ${displayNumber(position)} of ${displayNumber(total)}: ${documentCount(count)} out`;
}

export function stageMovedText(position: number, total: number): string {
  return `Stage moved to position ${displayNumber(position)} of ${displayNumber(total)}`;
}

export function stageDeletedText(position: number): string {
  return `Stage ${displayNumber(position)} deleted`;
}

export function importedText(inserted: number): string {
  return `Imported ${documentCount(inserted)}`;
}

export function tooManyLinesText(limit: number): string {
  return `File has more than ${displayNumber(limit)} lines`;
}

export function lineErrorText(line: number, message: string): string {
  return `Line ${displayNumber(line)}: ${message}`;
}

export function indexCreatedText(name: string): string {
  return `Index ${name} created`;
}

export function invitationCreatedText(email: string): string {
  return `Invitation created for ${email}`;
}

export function lastRunText(at: string | null, count: number | null): string {
  if (!at || count === null) return 'Never run';
  const stamp = `${at.slice(0, 10)} ${at.slice(11, 16)}`;
  return `Last run ${stamp} UTC, ${documentCount(count)} matched`;
}

export function schemaPresenceText(present: number): string {
  return `Present in ${displayNumber(present)}% of documents`;
}

export function schemaTypeText(type: string, share: number): string {
  return `${type} ${displayNumber(share)}%`;
}

export function accountStatusText(failure: ApiFailure): string {
  switch (failure.code) {
    case 'invalid_code':
      return 'That code is not right';
    case 'invalid_credentials':
      return 'Email or password is not right';
    case 'not_confirmed':
      return 'Confirm your email first';
    case 'email_taken':
      return 'An account with this email already exists';
    case 'invalid_field':
      return `Check the ${String(failure.body['field'])} field`;
    default:
      return 'That did not work';
  }
}

export function codeSentText(email: string): string {
  return `Check ${email} for your code`;
}

export function membersErrorText(failure: ApiFailure): string {
  switch (failure.code) {
    case 'already_member':
      return 'Already a member';
    case 'already_invited':
      return 'Already invited';
    case 'read_only':
      return READ_ONLY_NOTE;
    default:
      return 'That did not work';
  }
}

export function indexErrorText(failure: ApiFailure, validator: Validator | null): string {
  if (failure.code === 'invalid_index') return 'Index keys are not valid';
  return documentMessage(failure.code, failure.body, validator) ?? 'That did not work';
}

/** A save refusal: a document message, the read-only note or the deleted notice. */
export function saveErrorText(failure: ApiFailure, validator: Validator | null): string {
  if (failure.status === 403) return READ_ONLY_NOTE;
  if (failure.code === 'not_found') return DOCUMENT_GONE;
  return documentMessage(failure.code, failure.body, validator) ?? failure.code.replace(/_/g, ' ');
}
