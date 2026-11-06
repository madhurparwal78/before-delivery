// The one refusal shape every non-2xx JSON answer is built from, and the body checks shared by every endpoint.

export const BODY_LIMIT = 65_536;
const MAX_DEPTH = 8;

export const WORDING = Object.freeze({
  noEndpoint: "No such endpoint.",
  noMethod: "Method not allowed.",
  signedOut: "Sign in to continue.",
  ended: "Your session has ended. Sign in again.",
  noRequest: "No such request.",
  failed: "The desk could not complete that. Try again.",
  tooLarge: "Request body is too large.",
  notJson: "Send the body as application/json.",
  notObject: "The body must be a JSON object.",
  readOnly: "A shared link is read-only.",
});

export class Refusal extends Error {
  constructor(status, error, extra = {}, headers = {}) {
    super(error);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }

  get body() {
    return { error: this.message, ...this.extra };
  }
}

/** Health while starting: the brief prints this 503 body, flags in place of `error`, and it leaves like any refusal. */
export class NotReady extends Refusal {
  constructor(flags) {
    super(503, "starting");
    this.flags = flags;
  }

  get body() {
    return { status: "starting", ...this.flags };
  }
}

const MAX_ID = 2n ** 63n - 1n;

/** A path segment names a record only as a positive whole number no larger than the bigint range. */
export function pathId(segment) {
  return /^[1-9]\d{0,18}$/.test(segment) && BigInt(segment) <= MAX_ID ? segment : null;
}

export function refuse(status, error, extra, headers) {
  return new Refusal(status, error, extra, headers);
}

export function fieldRefusal(status, field, error) {
  return new Refusal(status, error, { field });
}

export function unpublished(key) {
  return fieldRefusal(400, key, `${key} cannot be set here.`);
}

export function required(field) {
  return fieldRefusal(400, field, `${field} is required.`);
}

export function nulRefusal(field) {
  return fieldRefusal(400, field, `${field} cannot contain a NUL character.`);
}

export function hasNul(value) {
  return typeof value === "string" && value.includes("\u0000");
}

export function isMissing(body, key) {
  return body[key] === undefined || body[key] === null;
}

/** Refuse the first key, in the body's own order, that the endpoint does not publish. */
export function onlyPublished(body, published) {
  const stray = Object.keys(body).find((key) => !published.includes(key));
  if (stray !== undefined) throw unpublished(stray);
}

/** Stops at the first container past the limit, so a body at the size limit cannot exhaust the stack. */
function tooDeep(value, level = 1) {
  if (value === null || typeof value !== "object") return false;
  return level > MAX_DEPTH || Object.values(value).some((inner) => tooDeep(inner, level + 1));
}

/**
 * The body checks of Server boundary, in order. Answers undefined when no body was sent.
 * @param {{body?: Buffer, headers: Record<string, string | string[] | undefined>}} request
 */
export function jsonBody(request) {
  const raw = request.body;
  if (!raw || raw.length === 0) return undefined;
  if (raw.length > BODY_LIMIT) throw refuse(413, WORDING.tooLarge);
  const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw refuse(400, WORDING.notJson);
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw refuse(400, WORDING.notObject);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || tooDeep(value)) {
    throw refuse(400, WORDING.notObject);
  }
  return value;
}
