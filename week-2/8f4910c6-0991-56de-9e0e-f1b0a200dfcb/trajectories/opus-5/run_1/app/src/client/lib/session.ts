import { call } from './api.js';
import { el } from './dom.js';
import { copy } from './copy.js';
import { navigate } from './router.js';
import type { Member } from '../../shared/types.js';

let member: Member | null = null;

export function cachedMember(): Member | null {
  return member;
}

export function setMember(next: Member | null): void {
  member = next;
}

export async function loadMember(): Promise<Member | null> {
  const result = await call<Member>('GET', '/api/me');
  member = result.body;
  return member;
}

export async function requireMember(path: string): Promise<Member | null> {
  const current = await loadMember();
  if (!current) {
    navigate(`/sign-in?return=${encodeURIComponent(path)}`, { replace: true });
    return null;
  }
  return current;
}

/** An ended session keeps the screen's values and offers a way back in. */
export function sessionEndedNotice(announce: (message: string) => void): HTMLElement {
  announce(copy.sessionEnded);
  const link = el('a', {
    class: 'link',
    href: `/sign-in?return=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    text: 'Sign in again',
  });
  return el('p', { class: 'session-notice' }, [link]);
}

export function isSessionError(code: string | undefined): boolean {
  return code === 'session_ended' || code === 'access_removed' || code === 'unauthenticated';
}
