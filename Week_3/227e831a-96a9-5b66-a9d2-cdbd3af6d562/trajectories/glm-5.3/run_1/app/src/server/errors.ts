/**
 * The one error shape. Every error the API answers is produced here, including
 * the 500. No route builds its own body, and no library message passes through.
 */

export interface FieldMessages {
  readonly [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldMessages | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldMessages) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): { error: { code: string; message: string; fields?: FieldMessages } } {
    const error: { code: string; message: string; fields?: FieldMessages } = { code: this.code, message: this.message };
    if (this.fields !== undefined) error.fields = this.fields;
    return { error };
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.');
export const invalidPassphrase = (): ApiError => new ApiError(401, 'invalid_passphrase', "That passphrase didn't match.");
export const notFound = (thing: string): ApiError => new ApiError(404, `${thing}_not_found`, 'Not found.');
export const readOnly = (): ApiError => new ApiError(405, 'read_only', 'This link is read-only.');
export const unknownRoute = (): ApiError => new ApiError(404, 'not_found', 'Not found.');
export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large', 'That upload is too large.');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'unsupported_media_type', 'That content type is not accepted.');
export const crossSiteRequest = (): ApiError => new ApiError(403, 'cross_site_request', 'This request did not come from Skinout.');
export const validationFailed = (fields: FieldMessages): ApiError => new ApiError(422, 'validation_failed', 'Check the highlighted fields.', fields);
export const internalError = (): ApiError => new ApiError(500, 'internal_error', 'Something went wrong. Try again.');
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable', 'Storage is unavailable right now. Try again later.');
export const printingUnavailable = (): ApiError => new ApiError(503, 'printing_unavailable', "Pack sheets can't be printed right now.");
export const requestInProgress = (): ApiError => new ApiError(409, 'request_in_progress', 'This retirement is still being processed.');
export const idempotencyKeyReused = (): ApiError => new ApiError(422, 'idempotency_key_reused', 'This key was already used for a different retirement.');
export const preconditionRequired = (): ApiError => new ApiError(428, 'precondition_required', 'Send the version you last saw.');
export const itemChanged = (name: string): ApiError => new ApiError(412, 'item_changed', `${name} changed on another device.`);
export const itemExists = (): ApiError => new ApiError(409, 'item_exists', 'An item with that name and category already exists.');
export const itemRetired = (name: string): ApiError => new ApiError(409, 'item_retired', `${name} is already retired.`);
export const itemInLists = (): ApiError => new ApiError(409, 'item_in_lists', 'That item is on a trip list and can\'t be deleted.');
export const lineExists = (): ApiError => new ApiError(409, 'line_exists', 'That item is already packed on this list.');
export const listNotFound = (): ApiError => new ApiError(404, 'list_not_found', 'Not found.');
export const lineNotFound = (): ApiError => new ApiError(404, 'line_not_found', 'Not found.');
export const listNotEditable = (listName: string, state: string): ApiError => new ApiError(409, 'list_not_editable', `${listName} is ${state} and can't be edited.`);
export const illegalTransition = (from: string, to: string): ApiError => new ApiError(409, 'illegal_transition', `Cannot move a ${from} list to ${to}.`);
export const emptyList = (): ApiError => new ApiError(409, 'empty_list', 'Add at least one item before marking this list packed.');
export const linesNotInCloset = (): ApiError => new ApiError(409, 'lines_not_in_closet', 'Some lines are not in your closet. Unpack them before marking this list packed.');
export const importCommitted = (): ApiError => new ApiError(409, 'import_committed', 'This import was already confirmed.');
export const shareNotFound = (): ApiError => new ApiError(404, 'share_not_found', 'Not found.');
