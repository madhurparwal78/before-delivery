// The one place error responses are shaped (API › Error shapes).
import type { Author } from "../shared/api-types.js";
import type { FieldErrors } from "../shared/graph.js";

type ErrorBody = Record<string, unknown>;

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(`${status} ${JSON.stringify(body)}`);
  }
}

type OutageService = "billing" | "file_storage";

export const unauthenticated = () => new HttpError(401, { error: "unauthenticated" });
export const invalidCredentials = () => new HttpError(401, { error: "invalid_credentials" });
export const invalidSignature = () => new HttpError(401, { error: "invalid_signature" });
export const forbidden = () => new HttpError(403, { error: "forbidden" });
export const crossOrigin = () => new HttpError(403, { error: "cross_origin" });
export const notFound = () => new HttpError(404, { error: "not_found" });
export const readOnlyRoute = () => new HttpError(405, { error: "read_only" });
export const workspaceReadOnly = () => new HttpError(402, { error: "workspace_read_only" });
export const cardDeclined = () => new HttpError(402, { error: "card_declined" });
export const gone = () => new HttpError(410, { error: "gone" });
export const linkExpired = () => new HttpError(410, { error: "link_expired" });
export const conflict = (code: string, extra: ErrorBody = {}) => new HttpError(409, { error: code, ...extra });
export const invalidTransition = (from: string, to: string) => conflict("invalid_transition", { from, to });
export const locked = (nodeId: string, holder: Author) => conflict("locked", { nodeId, holder });
export const payloadTooLarge = (limitBytes: number) => new HttpError(413, { error: "payload_too_large", limitBytes });
export const fileTooLarge = (limitBytes: number) => new HttpError(413, { error: "file_too_large", limitBytes });
export const unsupportedType = () => new HttpError(415, { error: "unsupported_type" });
export const invalid = (errors: FieldErrors) => new HttpError(422, { errors });
export const unavailable = (service: OutageService) => new HttpError(503, { error: "service_unavailable", service });
export const internalError = () => new HttpError(500, { error: "internal_error" });
