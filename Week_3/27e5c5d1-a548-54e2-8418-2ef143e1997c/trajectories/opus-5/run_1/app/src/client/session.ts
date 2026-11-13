import { call } from './lib/api';
import { clearMovers } from './motion';
import { signInPath } from './router';
import { clearAll } from './store';

const SIGNED_OUT_FLAG = 'kinfold:signed-out';

export function markSignedOut(): void {
  try {
    window.sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
  } catch {
    // A browser that refuses session storage simply shows no notice.
  }
}

export function takeSignedOutFlag(): boolean {
  try {
    const value = window.sessionStorage.getItem(SIGNED_OUT_FLAG);
    window.sessionStorage.removeItem(SIGNED_OUT_FLAG);
    return value === '1';
  } catch {
    return false;
  }
}

export function goToSignInAfterSignOut(): void {
  window.location.replace('/signin');
}

/** Any 401 sends the browser to sign-in carrying its return path. */
export function goToSignIn(): void {
  markSignedOut();
  window.location.replace(signInPath());
}

export async function signOut(): Promise<void> {
  try {
    await call<void>('/api/session', { method: 'DELETE', allowSignedOut: true });
  } catch {
    // The session is gone either way.
  }
  clearMovers();
  clearAll();
  document.getElementById('app')?.replaceChildren();
  goToSignInAfterSignOut();
}
