import { currentPath } from './dom';

/** A `next` value is followed only when it is a local path; anything else lands on the dashboard. */
export function localPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\\\u0000-\u001f]/.test(next)) return '/dashboard';
  return next;
}

export function goToSignIn(): void {
  location.assign(`/signin?next=${encodeURIComponent(currentPath())}`);
}
