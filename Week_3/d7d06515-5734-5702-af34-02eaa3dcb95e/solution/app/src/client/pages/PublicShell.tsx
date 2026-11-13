// Frame of the sign-up, check-inbox, verify, sign-in and open pages: the compact logo above one centred panel.
import type { ReactNode } from 'react';
import { Logo } from '../art/Logo.tsx';
import { Link } from '../router.tsx';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="public-header">
        <Link to="/" className="logo-link"><Logo /></Link>
      </header>
      <main className="public-main">
        <div className="public-panel">{children}</div>
      </main>
    </>
  );
}
