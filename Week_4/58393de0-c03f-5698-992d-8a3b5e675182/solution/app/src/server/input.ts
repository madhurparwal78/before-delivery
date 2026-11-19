/** A request-body value as text: the string itself, or empty when it is not a string. */
export function bodyText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
