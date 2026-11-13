// The safe `next` path (DP-70).
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/tonight";
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/tonight";
  }
  if (!decoded.startsWith("/")) return "/tonight";
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return "/tonight";
  if (decoded === "/signin" || decoded === "/signup") return "/tonight";
  return decoded;
}

export function signInPathWithNext(currentPathAndQuery: string): string {
  return `/signin?next=${encodeURIComponent(currentPathAndQuery)}`;
}
