const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids from a URL or body are checked before they reach a uuid column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
