import type { ServerResponse } from "node:http";
import type { Match, Entrant } from "../shared/types.js";
import { ERROR_MESSAGES as EM } from "../shared/types.js";

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra });
}

export const errors = {
  tooLargeJson: () => new ApiError(413, "too_large", EM.too_large_json(65536)),
  tooLargeFile: (limit: number) => new ApiError(413, "too_large", EM.too_large_file(limit)),
  unauthenticated: () => new ApiError(401, "unauthenticated", EM.unauthenticated),
  badCredentials: () => new ApiError(401, "bad_credentials", EM.bad_credentials),
  usernameTaken: () => new ApiError(409, "username_taken", EM.username_taken),
  rateLimitedLogin: () => new ApiError(429, "rate_limited", EM.rate_limited_login),
  rateLimitedReport: () => new ApiError(429, "rate_limited", EM.rate_limited_report),
  notFoundTournament: () => new ApiError(404, "not_found", EM.not_found_tournament),
  notFoundLink: () => new ApiError(404, "not_found", EM.not_found_link),
  notFoundDraft: () => new ApiError(404, "not_found", EM.not_found_draft),
  notFoundRoster: () => new ApiError(404, "not_found", EM.not_found_roster),
  notFound: () => new ApiError(404, "not_found", "We couldn't find that page."),
  readOnly: () => new ApiError(405, "read_only", EM.read_only),
  forbiddenTournament: () => new ApiError(403, "forbidden", EM.forbidden_tournament),
  forbiddenReport: () => new ApiError(403, "forbidden", EM.forbidden_report),
  forbiddenSelfConfirm: () => new ApiError(403, "forbidden", EM.forbidden_self_confirm),
  forbiddenResolve: () => new ApiError(403, "forbidden", EM.forbidden_resolve),
  forbiddenOrganizerOnly: () => new ApiError(403, "forbidden", EM.forbidden_organizer_only),
  crossSite: () => new ApiError(403, "forbidden", EM.forbidden_cross_site),
  staleMatch: (username: string, score: string, match: Match) =>
    new ApiError(409, "stale_match", EM.stale_match(username, score), { match }),
  alreadyResolved: (username: string, u: number, l: number, match: Match) =>
    new ApiError(409, "already_resolved", EM.already_resolved(username, `${u}-${l}`), { match }),
  stalePreview: () => new ApiError(409, "stale_preview", EM.stale_preview),
  staleSeeding: (username: string, entrants: Entrant[]) =>
    new ApiError(409, "stale_seeding", EM.stale_seeding(username), { entrants }),
  checkinClosed: () => new ApiError(409, "checkin_closed", EM.checkin_closed),
  validation: (fields: Record<string, string>, message = EM.validation_fields) =>
    new ApiError(422, "validation", message, { fields }),
  validationMsg: (message: string) => new ApiError(422, "validation", message),
  rosterInvalid: (errs: string[]) => new ApiError(422, "roster_invalid", EM.roster_invalid, { errors: errs }),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", EM.storage_unavailable),
  ws: (message: string) => new ApiError(409, "wrong_state", message),
};
