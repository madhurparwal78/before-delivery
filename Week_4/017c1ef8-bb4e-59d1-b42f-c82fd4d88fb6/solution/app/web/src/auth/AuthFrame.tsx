import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './auth.css';

/** Frame for join, confirm and sign-in: the monogram at the left, one flush-left column of type. */
export function AuthFrame({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="auth-frame">
      <header className="auth-header">
        <Link to="/" className="monogram" aria-label="Plainwork">
          <span className="sr-only">Pw</span>
        </Link>
      </header>
      <main className="auth-main">
        <h1 className="auth-title">{title}</h1>
        {lead ? <p className="t-larger muted auth-lead">{lead}</p> : null}
        {children}
      </main>
    </div>
  );
}
