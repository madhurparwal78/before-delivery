export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
    public fields?: Record<string, string>,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
  toJSON() {
    return {
      error: this.error,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}
export function fail(
  status: number,
  error: string,
  message: string,
  fields?: Record<string, string>,
  headers?: Record<string, string>,
): never {
  throw new ApiError(status, error, message, fields, headers);
}
export function notFound(): never {
  return fail(404, "not_found", "No such item.");
}
export function publicNotFound(): never {
  return fail(404, "not_found", "Nothing is published at this address.");
}
export function forbidden(): never {
  return fail(403, "forbidden", "Your current roles do not allow this.");
}
export function authorDenied(): never {
  return fail(
    403,
    "author_cannot_approve",
    "Authors cannot approve, sign off, clear, schedule or release their own work.",
  );
}
export function validation(fields: Record<string, string>): never {
  return fail(
    422,
    "validation_failed",
    "Please fix the highlighted fields.",
    fields,
  );
}
// Refuses a body carrying any key outside the accepted set for its endpoint.
export function acceptOnly(
  body: Record<string, unknown>,
  accepted: readonly string[],
): void {
  const offending = Object.keys(body).filter((key) => !accepted.includes(key));
  if (offending.length)
    fail(
      422,
      "read_only_fields",
      "Some fields are set by the server.",
      Object.fromEntries(
        offending.map((key) => [key, "This field is set by the server."]),
      ),
    );
}
export function illegal(from: string, to: string): never {
  return fail(
    409,
    "illegal_transition",
    `This item cannot move from ${from} to ${to}.`,
  );
}
export function stale(): never {
  return fail(
    412,
    "stale_version",
    "Someone else changed this item. Reload to see the latest version.",
  );
}
// Adapted from kit/modules/etag; the brief requires strong ETags and quoted versions.
export function requireVersion(header: string | undefined): number {
  if (!header)
    fail(
      428,
      "version_required",
      "Send the version you are changing in If-Match.",
    );
  const match = /^"(\d+)"$/.exec(header.trim());
  return match ? Number(match[1]) : -1;
}
export function checkVersion(expected: number, version: number): void {
  if (expected !== version) stale();
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
export const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
