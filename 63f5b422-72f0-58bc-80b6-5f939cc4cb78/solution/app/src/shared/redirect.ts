// Adapted from kit/modules/safe_redirect: a `next` target is accepted only as a same-origin path.

const CONTROL = /[\u0000-\u001f\u007f]/;

/** True only for a path that starts with exactly one "/", with no "\", scheme, host or control character, even after decoding. */
export function isSafeRedirect(target: unknown): target is string {
  if (typeof target !== "string" || target.length > 2048) return false;
  let s = target;
  for (let round = 0; round < 3; round += 1) {
    if (CONTROL.test(s) || s.includes("\\") || !s.startsWith("/") || s.startsWith("//")) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return false;
    }
    if (decoded === s) return new URL(target, "http://origin.invalid").origin === "http://origin.invalid";
    s = decoded;
  }
  return false;
}

export function safeRedirect(target: unknown, fallback = "/"): string {
  return isSafeRedirect(target) ? target : fallback;
}
