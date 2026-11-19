/** Where a sign-in may land: only a cockpit path named in `next`, with its query kept. */

const COCKPIT_ROOTS = ["app", "payments", "approvals", "invoices", "loans"];
const UNSAFE_CHARACTER = /[\\\s\u0000-\u001f\u007f]/;
const ENCODED_SEPARATOR = /%(2f|5c|2e)/i;

/** `value` is already decoded once as a query value. Returns the path to land on, or null for anything else. */
export function safeNext(value: string | null): string | null {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) return null;
  if (UNSAFE_CHARACTER.test(value)) return null;
  const queryStart = value.indexOf("?");
  const path = queryStart === -1 ? value : value.slice(0, queryStart);
  if (ENCODED_SEPARATOR.test(path)) return null;
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  const root = segments[0] ?? "";
  return COCKPIT_ROOTS.includes(root) ? value : null;
}

export const DEFAULT_LANDING = "/app";
