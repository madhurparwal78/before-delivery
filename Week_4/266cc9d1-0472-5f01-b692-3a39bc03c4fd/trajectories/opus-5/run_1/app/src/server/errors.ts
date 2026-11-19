/** The one API error shape and every message that travels in it. */

import { LIMITS } from "./config.js";
import { chainage } from "../shared/format.js";
import { STORAGE_UNAVAILABLE_MESSAGE } from "../shared/copy.js";

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function payloadTooLarge(limitBytes: number): ApiError {
  return new ApiError(
    413,
    "payload_too_large",
    `Request body may be at most ${limitBytes.toLocaleString("en-US")} bytes.`,
  );
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, "unsupported_media_type", "Send this request as application/json.");
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in to use this endpoint.");
}

export function invalidAccessCode(message: string): ApiError {
  return new ApiError(401, "invalid_access_code", message);
}

export function linkNotFound(): ApiError {
  return new ApiError(404, "link_not_found", "This review link does not exist.");
}

export function linkRevoked(): ApiError {
  return new ApiError(410, "link_revoked", "This review link has been withdrawn.");
}

export function linkExpired(): ApiError {
  return new ApiError(410, "link_expired", "This review link has expired.");
}

export function idempotencyConflict(): ApiError {
  return new ApiError(
    409,
    "idempotency_conflict",
    "This Idempotency-Key was already used with a different body.",
  );
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "No such resource.");
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}

export function crossOrigin(): ApiError {
  return new ApiError(403, "cross_origin", "Cross-origin requests are not accepted.");
}

export function validationFailed(fields: FieldErrors): ApiError {
  return new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
}

export function checksumMismatch(field: "size_bytes" | "sha256"): ApiError {
  const message =
    field === "size_bytes"
      ? "Bytes did not match the declared size."
      : "Bytes did not match the declared SHA-256.";
  return new ApiError(422, "checksum_mismatch", "The bytes did not match the manifest.", {
    fields: { [field]: message },
  });
}

export function invalidCzml(): ApiError {
  return new ApiError(
    422,
    "invalid_czml",
    "The flight track has no position samples with an epoch and availability.",
  );
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", STORAGE_UNAVAILABLE_MESSAGE);
}

export function rangeNotSatisfiable(): ApiError {
  return new ApiError(416, "range_not_satisfiable", "That byte range is not inside the file.");
}

export function conflict(code: string, message: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, code, message, extra);
}

export type SetAction = "submit" | "close" | "revise" | "regenerate";

export function illegalTransition(from: string, action: SetAction): ApiError {
  return new ApiError(409, "illegal_transition", `Cannot ${action} a ${from} findings set.`, {
    from,
    action,
  });
}

/** Field messages shared by the API and the finding editor. */
export const FIELD_MESSAGES = {
  accessCode: "Enter your access code.",
  position: "Give either chainage and offset or longitude and latitude.",
  chainage: (lengthM: number): string =>
    `Chainage must be between 0 and ${chainage(lengthM)} metres.`,
  offset: "Offset must be between -60 and 60 metres.",
  groundHeight: "Ground height must be between -500 and 9,000 metres.",
  terrainLevel: "Terrain level must be a whole number from 0 to 24, or empty.",
  canopyHeight: "Canopy height must be between 0.5 and 80 metres.",
  canopyRadius: "Canopy radius must be between 0.5 and 20 metres.",
  comment: `Comment must be ${LIMITS.maxCommentChars.toLocaleString("en-US")} characters or fewer.`,
  flightQuery: "Give exactly one of chainage_m or time.",
  assetKind: "Choose tileset, terrain or czml.",
  filesCount: `Declare between 1 and ${LIMITS.maxManifestFiles.toLocaleString("en-US")} files.`,
  filesTileset: "A tileset must include tileset.json.",
  filesTerrain: "A terrain pyramid must include layer.json.",
  filesCzml: "A flight track is exactly one .czml file.",
  filesUnique: "Each path may appear once.",
  filePath:
    "Use a relative path of letters, digits, dot, dash and underscore segments.",
  fileSize: `Each file must be between 1 and ${LIMITS.fileBodyBytes.toLocaleString(
    "en-US",
  )} bytes.`,
  fileSha256: "Give the SHA-256 as 64 lowercase hex characters.",
  submitEmptyDraft: "Add at least one finding before submitting.",
  decision: "Choose accept or dispute.",
  disputeNote: "Add a note explaining the dispute.",
  completeUndecided: "Decide every finding before sending.",
} as const;
