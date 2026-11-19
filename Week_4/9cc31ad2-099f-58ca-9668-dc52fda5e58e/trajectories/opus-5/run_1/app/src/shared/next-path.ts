const LOBBY_PATH = /^\/lobby\/[A-Za-z0-9_-]+$/;

/** The next-address rule: only a same-origin lobby path is followed. */
export function acceptedNextPath(raw: string | null): string | null {
  if (raw === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return LOBBY_PATH.test(decoded) ? decoded : null;
}
