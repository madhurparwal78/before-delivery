import { FIELD, type Fields } from "../shared/field-messages.js";
import { SCHEMA_HAS_ERRORS, refusalMessage, type Refusal } from "../shared/writes.js";

export type ErrorBody = { error: string; message: string } & Record<string, unknown>;

/** Every API error, in the one published shape. Thrown by handlers and written by the router. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.message);
  }
}

const make = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new ApiError(status, { error, message, ...extra }, headers);

export const fail = {
  signedOut: () => make(401, "signed_out", "Sign in to continue."),
  notFound: () => make(404, "not_found", "Nothing is here."),
  readOnly: () => make(403, "read_only", "You can view this project but not change it."),
  ownerOnly: () => make(403, "owner_only", "Only the owner can do this."),
  badOrigin: () => make(403, "bad_origin", "This connection must come from the studio page."),
  joinFirst: () => make(403, "join_first", "Join the project before editing."),
  denied: (reason: "read_only" | "owner_only") => (reason === "read_only" ? fail.readOnly() : fail.ownerOnly()),
  staleRevision: (revision: number, text: string) =>
    make(409, "stale_revision", "The text changed. Try again on the latest version.", { revision, text }),
  schemaHasErrors: () => make(409, "schema_has_errors", SCHEMA_HAS_ERRORS),
  editConflict: (unit: string, by: string, revision: number, text: string) =>
    make(409, "edit_conflict", `${by} changed ${unit} first.`, { revision, text, conflicts: [{ unit, by }] }),
  versionHasErrors: () => make(409, "version_has_errors", "One of these versions has errors in its text."),
  shareNotActive: () => make(409, "share_not_active", "This link is no longer active."),
  noInvitation: () => make(409, "no_invitation", "This link has no invitation email."),
  ownerRoleFixed: () => make(409, "owner_role_fixed", "The owner's access cannot change."),
  exportExpired: () => make(409, "export_expired", "This download has expired. Save the export again."),
  invalid: (fields: Fields) => make(422, "invalid", "Some fields need attention.", { fields }),
  importFailed: (lines: string[]) => make(422, "import_failed", "The import was not applied.", { lines }),
  textTooLarge: (limit: number) => make(413, "too_large", `Text is larger than ${limit} bytes.`),
  ddlTooLarge: (limit: number) => make(413, "too_large", `The DDL is larger than ${limit} bytes.`),
  bodyTooLarge: (limit: number) => make(413, "too_large", `The request body is larger than ${limit} bytes.`),
  rateLimited: (retryAfterSeconds: number) =>
    make(429, "rate_limited", "Too many exports. Try again in a minute.", {}, { "Retry-After": String(retryAfterSeconds) }),
  storage: () => make(503, "storage_unavailable", "Storage is unavailable. Your diagram is safe; try again shortly."),
  mail: () => make(503, "mail_unavailable", "Mail is unavailable. Try again shortly."),
  database: () => make(503, "database_unavailable", "The studio database is unavailable. Try again shortly."),
  server: () => make(500, "server_error", "Something went wrong. Try again."),
  refused: (refusal: Refusal) => {
    if (refusal.kind === "fields") return fail.invalid(refusal.fields);
    return make(409, refusal.kind, refusalMessage(refusal));
  },
};

export { FIELD, type Fields };
