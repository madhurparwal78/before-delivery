// A next/return address is accepted only as a same-origin relative path (adapted from the kit's safe_redirect module).
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LENGTH = 2048;
const DECODING_ROUNDS = 3;

const isSafe = (target: string): boolean => {
  if (target.length > MAX_LENGTH) return false;
  let current = target;
  for (let round = 0; round < DECODING_ROUNDS; round += 1) {
    if (CONTROL.test(current) || current.includes('\\') || !current.startsWith('/') || current.startsWith('//')) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return new URL(target, 'http://origin.invalid').origin === 'http://origin.invalid';
    current = decoded;
  }
  return false;
};

/** The target when it is a safe relative path, otherwise the fallback. */
const safeRedirect = (target: string | null, fallback: string): string => (target !== null && isSafe(target) ? target : fallback);

/** Where to go after signing in: the page that asked for it, else the matches. */
export const afterSignIn = (): string => safeRedirect(new URLSearchParams(location.search).get('next'), '/matches');
