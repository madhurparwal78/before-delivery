const CONTROL = /[\u0000-\u001f\u007f]/;

function safeAfterDecoding(target: string, depth: number): boolean {
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\") || CONTROL.test(target)) return false;
  if (depth === 0) return true;
  try {
    const decoded = decodeURIComponent(target);
    return decoded === target || safeAfterDecoding(decoded, depth - 1);
  } catch {
    return false;
  }
}

/** The page a signed-out visitor asked for, when it is a path on this site; otherwise Home. */
export function safeRedirect(target: string | null): string {
  return target !== null && target.length <= 2048 && safeAfterDecoding(target, 3) ? target : "/";
}
