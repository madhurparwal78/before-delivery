import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SessionUser, StatusResponse } from '../../shared/api';
import { apiGet, apiJson } from './api';
import { useAuth } from './App';
import { COPY } from './hooks';

export function TopBar({ user }: { user: SessionUser }): ReactNode {
  const { signOut } = useAuth();
  const location = useLocation();
  const isPointInTime = location.pathname === '/catalog' && new URLSearchParams(location.search).has('as_of');

  const onSignOut = async (): Promise<void> => {
    await apiJson('DELETE', '/api/session');
    signOut();
  };

  return (
    <header className="topbar">
      <Link className="wordmark" to="/catalog">
        Quarrystone Strata
      </Link>
      <nav aria-label="Main">
        <Link
          className={location.pathname === '/catalog' ? 'nav-link active' : 'nav-link'}
          to={isPointInTime ? '/catalog' : location.pathname + location.search}
        >
          Catalog
        </Link>
        <Link className={location.pathname === '/glossary' ? 'nav-link active' : 'nav-link'} to="/glossary">
          Glossary
        </Link>
        {user.role === 'Admin' && (
          <Link className={location.pathname === '/admin' ? 'nav-link active' : 'nav-link'} to="/admin">
            Admin
          </Link>
        )}
      </nav>
      <div className="topbar-user">
        <span className="who">{user.name}</span>
        <span className="role-tag">{user.role}</span>
        <button type="button" className="btn" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}

/** In-flow notes under the top bar: outage banners, then the Point in time note. */
export function Notes({ status, pointInTime }: { status: StatusResponse | null; pointInTime: ReactNode }): ReactNode {
  return (
    <>
      {status?.evidence === 'down' && (
        <div role="alert" className="banner">
          {COPY.evidenceOutage}
        </div>
      )}
      {status?.mail === 'down' && (
        <div role="alert" className="banner">
          <div>{COPY.mailOutage}</div>
          <div data-queued-notices="" className="mono banner-count">
            {COPY.queuedNotices(status.queued_notices)}
          </div>
        </div>
      )}
      {pointInTime}
    </>
  );
}

export interface StatusPoller {
  status: StatusResponse | null;
  refreshNow: () => void;
}

/** GET /api/status, polled every 5 seconds (DP-66). */
export function useStatus(signedIn: boolean): StatusResponse | null {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    let generation = 0;
    const load = async (): Promise<void> => {
      const res = await apiGet<StatusResponse>('/api/status');
      if (!cancelled) {
        generation += 1;
        if (res.status === 200) setStatus(res.body);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [signedIn]);
  return status;
}


