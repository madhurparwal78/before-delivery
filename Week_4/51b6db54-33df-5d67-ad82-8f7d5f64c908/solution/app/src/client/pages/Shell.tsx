import type { ComponentChildren, JSX } from 'preact';
import { navigate } from '../router';
import { api } from '../api';
import { loadMe, useMe } from '../session';
import { Notices } from '../ui';

/** Page frame for every screen except the workspace: header, content, and the notice regions. */
export function Shell({ children, bare = false }: { children: ComponentChildren; bare?: boolean }): JSX.Element {
  const me = useMe();
  const signOut = async (): Promise<void> => {
    await api('POST', '/api/auth/logout');
    await loadMe();
    navigate('/');
  };
  return (
    <div class="shell">
      {!bare && (
        <header class="site-bar">
          <a href="/" data-route class="wordmark">
            Celmate
          </a>
          <nav aria-label="Account">
            {me ? (
              <>
                <a href="/projects" data-route class="pill small">
                  Projects
                </a>
                <button type="button" class="pill small" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <a href="/signin" data-route class="pill small">
                Sign in
              </a>
            )}
          </nav>
        </header>
      )}
      {children}
      <Notices />
    </div>
  );
}
