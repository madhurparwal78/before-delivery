import type { ConflictBody, FieldErrors, Status } from "../../shared/types";

/** Every error body the API sends is built here, one shape per status. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: object) {
    super(JSON.stringify(body));
  }
}

export const badJson = (): ApiError => new ApiError(400, { error: "bad_json" });
export const signInRequired = (): ApiError => new ApiError(401, { error: "sign_in_required" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const crossOrigin = (): ApiError => new ApiError(403, { error: "cross_origin" });
export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const packetPending = (): ApiError => new ApiError(409, { error: "packet_pending" });
export const illegalStatus = (status: Status): ApiError => new ApiError(409, { error: "illegal_status", status });
export const deadlinePassed = (): ApiError => new ApiError(409, { error: "deadline_passed" });
export const conflict = (version: number, status: Status, changedBy: string): ApiError =>
  new ApiError(409, { error: "conflict", return: { version, status }, changed_by: changedBy } satisfies ConflictBody);
export const tooLarge = (): ApiError => new ApiError(413, { error: "too_large" });
export const unsupportedMediaType = (): ApiError => new ApiError(415, { error: "unsupported_media_type" });
export const serverError = (): ApiError => new ApiError(500, { error: "server_error" });
export const invalid = (errors: FieldErrors): ApiError => new ApiError(422, { errors });
