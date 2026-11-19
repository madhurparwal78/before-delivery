import { config, IMPORT_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES, MAX_JSON_DEPTH, MAX_NAME_CHARS } from './config';

export interface ApiErrorExtras {
  step_id?: string;
  step?: unknown;
  field?: string;
  headers?: Record<string, string>;
}

/** The single error shape every refused request answers with. */
export class ApiError extends Error {
  readonly status: number;
  readonly extras: ApiErrorExtras;

  constructor(status: number, message: string, extras: ApiErrorExtras = {}) {
    super(message);
    this.status = status;
    this.extras = extras;
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.message };
    if (this.extras.step_id !== undefined) body.step_id = this.extras.step_id;
    if (this.extras.step !== undefined) body.step = this.extras.step;
    if (this.extras.field !== undefined) body.field = this.extras.field;
    return body;
  }
}

/** Every refusal message the API can answer, defined once. */
export const messages = {
  signInRequired: 'Sign in required',
  notFound: 'Not found',
  viewerRefused: 'Viewers cannot change this workspace',
  ownerOnly: 'Only owners can do this',
  crossOrigin: 'Cross-origin request refused',
  bodyTooLarge: `Body is larger than ${JSON_BODY_LIMIT_BYTES} bytes`,
  importTooLarge: `Body is larger than ${IMPORT_BODY_LIMIT_BYTES} bytes`,
  contentTypeJson: 'Content type must be application/json',
  badJson: 'Body is not valid JSON',
  notAnObject: 'Body must be a JSON object',
  tooDeep: `JSON is nested more than ${MAX_JSON_DEPTH} levels deep`,
  nameTooLong: `Name must be ${MAX_NAME_CHARS} characters or fewer`,
  emailTaken: 'That email already has an account',
  enterName: 'Enter your name',
  enterEmail: 'Enter a valid email address',
  shortPassword: 'Password must be at least 8 characters',
  mailUnavailable: 'Email is unavailable',
  wrongCredentials: 'Email or password is wrong',
  confirmFirst: 'Confirm your email first',
  alreadyMember: 'That person is already a member',
  badRole: 'Role must be editor or viewer',
  tableNameRequired: 'Table name is required',
  atLeastOneColumn: 'Add at least one column',
  uniqueColumns: 'Column names must be unique',
  columnType: 'Column type must be text or number',
  nameRequired: 'Name is required',
  cellTaken: 'That cell is already taken',
  cellOutside: 'That cell is outside the grid',
  triggerUndeletable: 'The trigger cannot be deleted',
  sampleObject: 'Sample data must be a JSON object',
  storageUnavailable: 'Storage is unavailable',
  importBadJson: 'Import is not valid JSON',
  importNotSwitchyard: 'Import is not a Switchyard automation',
  publishBeforeRunning: 'Publish a version before running',
  manualOnly: 'Only manual automations can be run by hand',
  runInputObject: 'Run input must be a JSON object',
  onlyFailedReplay: 'Only a failed run can be replayed',
  replayAtOrBefore: 'Replay must start at or before the failed step',
  replayInLoop: 'Replay cannot start inside a loop',
  clockArgs: 'Send advance_seconds or set',
  gradingEmailExists: 'Email already exists',
  methodNotAllowed: 'Method not allowed',
  webhookContentType: 'Content type must be application/json or application/x-www-form-urlencoded',
  webhookTooLarge: `Body is larger than ${config.webhookBodyLimitBytes} bytes`,
  idempotencyConflict: 'Idempotency-Key was already used with a different body',
  unknownNodeKind: (kind: string): string => `Unknown node kind: ${kind}`,
  unknownStatus: (value: string): string => `Unknown status: ${value}`,
  noDraftChanges: (version: number): string => `The draft has no changes since version ${version}`,
  runFinished: (number: number): string => `Run #${number} has already finished`,
  unknownStep: (id: string): string => `Unknown step: ${id}`,
  triggerIncoming: 'The trigger cannot have an incoming edge',
  noPort: (from: string, port: string): string => `Step ${from} has no port ${port}`,
  cycle: (id: string): string => `That edge would close a cycle at step ${id}`,
  alreadyIncoming: (to: string): string => `Step ${to} already has an incoming edge`,
  notConnected: (id: string): string => `Step ${id} is not connected to the trigger`,
  needsValue: (id: string, label: string): string => `Step ${id} needs a value for ${label}`,
  badSchedule: 'Step trigger has a schedule that is not every N minutes or daily at HH:MM',
  pathTaken: 'Step trigger needs a path no other live automation uses',
  waitRange: (id: string): string => `Step ${id} must wait between 1 and ${config.waitMaxSeconds} seconds`,
  ownAddressOnly: (id: string): string => `Step ${id} can only call this app's own address`,
  nestedLoop: (id: string): string => `Step ${id} is a loop inside another loop`,
  requiredField: (label: string): string => `${label} is required`,
  mustBeNumber: (label: string): string => `${label} must be a number`,
  numberColumn: (column: string): string => `Column ${column} must be a number`,
} as const;

export const stepFailures = {
  loopNotList: 'Loop source is not a list',
  tableNotFound: (value: string): string => `Table not found: ${value}`,
  notMember: (address: string): string => `Recipient is not a workspace member: ${address}`,
  mailRefused: 'Mail server did not accept the message',
  rowNotFound: (rowId: string): string => `Row ${rowId} not found`,
  webhookStatus: (status: number): string => `Webhook answered ${status}`,
  webhookUnreachable: 'Webhook could not be reached',
} as const;

export const runMessages = {
  stepFailed: (id: string, attempts: number, message: string): string =>
    `Step ${id} failed after ${attempts} attempts: ${message}`,
  stepLimit: `Step limit of ${config.stepLimit} reached`,
} as const;

export const badRequest = (message: string, extras?: ApiErrorExtras): ApiError => new ApiError(422, message, extras);
export const notFound = (): ApiError => new ApiError(404, messages.notFound);
export const conflict = (message: string, extras?: ApiErrorExtras): ApiError => new ApiError(409, message, extras);
