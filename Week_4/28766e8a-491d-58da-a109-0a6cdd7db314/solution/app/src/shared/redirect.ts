// Safe `next` targets (brief: Screens, "a path starting with a single /"). Adapted from
// kit/modules/safe_redirect.

import { hasControl } from "./text";

export function safeNext(target: string | null): string {
  if (target === null || target.length > 2048) return "/";
  let s = target;
  for (let round = 0; round < 3; round++) {
    if (hasControl(s) || s.includes("\\") || !s.startsWith("/") || s.startsWith("//")) return "/";
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return "/";
    }
    if (decoded === s) return new URL(target, "http://origin.invalid").origin === "http://origin.invalid" ? target : "/";
    s = decoded;
  }
  return "/";
}
