/**
 * Return-address (sign-in redirect) rule — the single decision place.
 */
export function isSafeReturnAddress(next: string | undefined | null): boolean {
  if (!next) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return false;
  }
  if (!decoded.startsWith('/')) return false;
  if (decoded.startsWith('//')) return false;
  if (decoded.startsWith('/\\')) return false;
  const second = decoded[1];
  if (second === undefined || second === '/' || second === '\\') return false;
  if (decoded.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return false;
  if (decoded === '/api' || decoded.startsWith('/api/')) return false;
  if (decoded === '/sign-in' || decoded.startsWith('/sign-in?')) return false;
  return true;
}

export const ROLE_HOME: Record<string, string> = {
  concierge: '/bays',
  care_technician: '/round',
  workshop_lead: '/jobs',
  house_manager: '/board',
  owner: '/portal',
};
