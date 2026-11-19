import type { Role } from './types';

export function landingPath(role: Role): string {
  if (role === 'coordinator') return '/office';
  if (role === 'volunteer') return '/desk';
  return '/account';
}

export type Screen =
  | { kind: 'pegboard' }
  | { kind: 'signin' }
  | { kind: 'join' }
  | { kind: 'account' }
  | { kind: 'desk' }
  | { kind: 'office' }
  | { kind: 'loan'; id: number }
  | { kind: 'fee'; id: number }
  | { kind: 'not-found' };

const WHOLE_NUMBER = /^\d+$/;

export function screenForPath(path: string): Screen {
  if (path === '/') return { kind: 'pegboard' };
  if (path === '/signin') return { kind: 'signin' };
  if (path === '/join') return { kind: 'join' };
  if (path === '/account') return { kind: 'account' };
  if (path === '/desk') return { kind: 'desk' };
  if (path === '/office') return { kind: 'office' };
  const loan = /^\/loans\/([^/]+)$/.exec(path);
  if (loan?.[1] && WHOLE_NUMBER.test(loan[1])) return { kind: 'loan', id: Number(loan[1]) };
  const fee = /^\/fees\/([^/]+)$/.exec(path);
  if (fee?.[1] && WHOLE_NUMBER.test(fee[1])) return { kind: 'fee', id: Number(fee[1]) };
  return { kind: 'not-found' };
}

export function roleMayUseScreen(role: Role, screen: Screen): boolean {
  switch (screen.kind) {
    case 'pegboard':
    case 'loan':
    case 'fee':
      return true;
    case 'account':
      return role === 'member';
    case 'desk':
      return role === 'volunteer' || role === 'coordinator';
    case 'office':
      return role === 'coordinator';
    default:
      return false;
  }
}

/**
 * Where a successful sign-in goes. The one place that decides whether a `next`
 * path is followed; anything else lands on the role's landing path.
 */
export function destinationAfterSignIn(nextValue: string | null, role: Role): string {
  if (nextValue === null) return landingPath(role);
  let decoded: string;
  try {
    decoded = decodeURIComponent(nextValue);
  } catch {
    return landingPath(role);
  }
  if (!decoded.startsWith('/')) return landingPath(role);
  const second = decoded.charAt(1);
  if (second === '/' || second === '\\') return landingPath(role);
  if (/[?#]/.test(decoded)) return landingPath(role);
  const screen = screenForPath(decoded);
  const allowed =
    screen.kind === 'pegboard' ||
    screen.kind === 'account' ||
    screen.kind === 'desk' ||
    screen.kind === 'office' ||
    screen.kind === 'loan' ||
    screen.kind === 'fee';
  if (!allowed || !roleMayUseScreen(role, screen)) return landingPath(role);
  return decoded;
}

export function signInPathFor(path: string): string {
  return `/signin?next=${encodeURIComponent(path)}`;
}
