function isSafeRedirect(target: unknown): target is string {
  if (typeof target !== "string" || target.length > 2048) return false;
  let text = target;
  for (let round = 0; round < 3; round += 1) {
    if (/[\u0000-\u001f\u007f]/.test(text) || text.includes("\\") || !text.startsWith("/") || text.startsWith("//")) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      return false;
    }
    if (decoded === text) return new URL(target, "http://origin.invalid").origin === "http://origin.invalid";
    text = decoded;
  }
  return false;
}

export function safeRedirect(target: unknown, fallback: string): string {
  return isSafeRedirect(target) ? target : fallback;
}
