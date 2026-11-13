/** The safe-return rule: decided here, once, for the server's `landing` and nowhere else. */
export function isSafeReturn(value: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (!decoded.startsWith("/")) return false;
  if (decoded.length > 1 && (decoded[1] === "/" || decoded[1] === "\\")) return false;
  for (const char of decoded) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return !decoded.startsWith("/api/");
}

export function signInReturnPath(pathAndQuery: string): string {
  return `/sign-in?return=${encodeURIComponent(pathAndQuery)}`;
}
