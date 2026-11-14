import { SHARE_EXPIRY_MAX_SECONDS, type ApiErrorBody } from '../shared/domain.ts'
import { COPY } from '../shared/copy.ts'
import { config } from './config.ts'

/** An API error. Every error body in the server is built here, in the one published shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.message)
  }
}

function fail(status: number, error: string, message: string, extra: Omit<ApiErrorBody, 'error' | 'message'> = {}, headers: Record<string, string> = {}): ApiError {
  return new ApiError(status, { error, message, ...extra }, headers)
}

export const signedOut = (): ApiError => fail(401, 'signed_out', 'Sign in to continue.')
export const notFound = (): ApiError => fail(404, 'not_found', 'Nothing is here.')
export const readOnly = (): ApiError => fail(403, 'read_only', 'You can view this project but not change it.')
export const ownerOnly = (): ApiError => fail(403, 'owner_only', 'Only the owner can do this.')
export const joinFirst = (): ApiError => fail(403, 'join_first', 'Join the project before editing.')
export const staleRevision = (revision: number, text: string): ApiError =>
  fail(409, 'stale_revision', 'The text changed. Try again on the latest version.', { revision, text })
export const schemaHasErrors = (): ApiError => fail(409, 'schema_has_errors', COPY.fixErrorsFirst)
export const versionHasErrors = (): ApiError => fail(409, 'version_has_errors', 'One of these versions has errors in its text.')
export const linkExists = (): ApiError => fail(409, 'link_exists', 'That link already exists.')
export const alreadyGrouped = (entity: string, group: string): ApiError =>
  fail(409, 'already_grouped', `${entity} is already in group "${group}".`)
export const shareNotActive = (): ApiError => fail(409, 'share_not_active', 'This link is no longer active.')
export const noInvitation = (): ApiError => fail(409, 'no_invitation', 'This link has no invitation email.')
export const ownerRoleFixed = (): ApiError => fail(409, 'owner_role_fixed', "The owner's access cannot change.")
export const exportExpired = (): ApiError => fail(409, 'export_expired', COPY.exportExpired)
export const editConflict = (revision: number, text: string, unit: string, by: string): ApiError =>
  fail(409, 'edit_conflict', `${by} changed ${unit} first.`, { revision, text, conflicts: [{ unit, by }] })
export const invalid = (fields: Record<string, string>): ApiError =>
  fail(422, 'invalid', 'Some fields need attention.', { fields })
export const importFailed = (lines: string[]): ApiError => fail(422, 'import_failed', 'The import was not applied.', { lines })
export const textTooLarge = (): ApiError => fail(413, 'too_large', `Text is larger than ${config.limits.textLimitBytes} bytes.`)
export const ddlTooLarge = (): ApiError => fail(413, 'too_large', `The DDL is larger than ${config.limits.textLimitBytes} bytes.`)
export const rateLimited = (retryAfterSeconds: number): ApiError =>
  fail(429, 'rate_limited', 'Too many exports. Try again in a minute.', {}, { 'Retry-After': String(retryAfterSeconds) })
export const storageUnavailable = (): ApiError =>
  fail(503, 'storage_unavailable', 'Storage is unavailable. Your diagram is safe; try again shortly.')
export const serverError = (): ApiError => fail(500, 'server_error', 'Something went wrong on our side. Try again shortly.')
export const crossOrigin = (): ApiError => fail(403, 'cross_origin', 'Connections from another origin are refused.')
export const databaseUnavailable = (): ApiError => fail(503, 'database_unavailable', 'The studio database is unavailable. Try again shortly.')
export const mailUnavailable = (): ApiError => fail(503, 'mail_unavailable', 'Mail is unavailable. Try again shortly.')

export const FIELD = {
  email: 'Enter a valid email address.',
  displayName: 'Enter a display name of 1 to 40 characters.',
  projectName: 'Enter a project name of 1 to 80 characters.',
  versionName: 'Enter a version name of 1 to 80 characters.',
  baseRevision: 'Send the revision your text is based on.',
  text: 'Send the text as a string.',
  dialect: 'Pick postgresql or mysql.',
  mode: 'Pick merge or replace.',
  template: 'Pick a listed template.',
  code: 'That code is wrong or has expired.',
  access: 'Pick view or edit.',
  expiresInSeconds: `Use a whole number of seconds from 1 to ${SHARE_EXPIRY_MAX_SECONDS}.`,
  role: 'Pick editor or viewer.',
  coordinate: 'Use a whole number from 0 to 500.',
  color: 'Pick one of slate, blue, violet, green, amber or red.',
  groupName: 'Enter a group name of 1 to 40 characters without double quotes.',
  groupTaken: 'A group with this name already exists.',
  entities: 'Pick at least one entity.',
  newName: 'Use 1 to 64 characters without double quotes, dots, backticks or backslashes.',
  nameTaken: 'That name is already used.',
  sameColumn: COPY.sameColumn,
  patch: 'Send the changes as an object keyed by name.',
  ref: 'Send a ref for each entry.',
  knownRef: 'Name a ref from the users list.',
} as const

export const noEntity = (name: string): string => `No entity ${name}.`
export const noColumn = (ref: string): string => `No column ${ref}.`
export const noGroup = (name: string): string => `No group ${name}.`
