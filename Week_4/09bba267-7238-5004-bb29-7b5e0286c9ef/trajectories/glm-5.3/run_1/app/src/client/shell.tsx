import { useEffect, useState, type ReactNode } from 'react';

export function TopBar({ active }: { active: 'programme' | 'tickets' | 'owner' | null }) {
  return (
    <header className="topbar">
      <a className="wordmark" href="/">Halyard Hall</a>
      <nav aria-label="Box office">
        <a className={active === 'programme' ? 'active' : ''} href="/">Programme</a>
        <a className={active === 'tickets' ? 'active' : ''} href="/tickets">My tickets</a>
      </nav>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <TopBar active={null} />
      <main className="content">{children}</main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page">
      <TopBar active={null} />
      <main className="content">
        <h1>We couldn't find that page</h1>
      </main>
    </div>
  );
}

export function UpdatesRegion() {
  return (
    <div id="box-office-updates" role="status" aria-live="polite" className="visually-hidden" />
  );
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export function navigate(to: string, replace = false): void {
  if (replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}
