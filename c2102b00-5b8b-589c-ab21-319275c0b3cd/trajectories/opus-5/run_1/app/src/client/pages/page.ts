import type { Club, Me } from '../../shared/types.ts';

export interface Page {
  element: HTMLElement;
  start: () => void;
  destroy: () => void;
}

export type LiveName = 'coordinator' | 'bag';

export interface Shell {
  me: Me;
  club: Club;
  setBanner: (key: string, text: string | null) => void;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  checkPayments: () => void;
  say: (region: LiveName, text: string) => void;
}

export function homeFor(role: Me['role']): string {
  if (role === 'coordinator') return '/coordinator';
  if (role === 'volunteer') return '/breakdown';
  return '/';
}

export function roleMaySee(role: Me['role'], path: string): boolean {
  if (path === '/breakdown') return role === 'volunteer' || role === 'coordinator';
  if (path.startsWith('/coordinator')) return role === 'coordinator';
  if (path === '/' || path === '/credit' || path.startsWith('/cycles/')) return role === 'member';
  return false;
}

export function knownPath(path: string): boolean {
  if (['/', '/credit', '/breakdown', '/coordinator', '/coordinator/cycles/new'].includes(path)) return true;
  if (/^\/cycles\/[^/]+$/.test(path)) return true;
  if (/^\/coordinator\/cycles\/[^/]+$/.test(path)) return true;
  return false;
}
