import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { offerArrivedAnnouncement } from '../../shared/copy';
import { api } from '../lib/api';
import { useAnnouncer } from '../lib/announce';
import { useLiveUpdates } from '../lib/live';
import { Link } from '../lib/router';

/** Watches this browser's waitlist entries so an arriving offer is announced on every page. */
function useOfferArrivals(): void {
  const { announce } = useAnnouncer();
  const known = useRef<Set<string> | null>(null);

  const check = useCallback(async () => {
    const result = await api.waitlist();
    if (result.data === undefined) return;
    const open = new Set(
      result.data.entries
        .filter((entry) => entry.offer !== null && entry.offer.status === 'open')
        .map((entry) => entry.offer?.token ?? ''),
    );
    const seen = known.current;
    known.current = open;
    if (seen === null) return;
    for (const entry of result.data.entries) {
      const offer = entry.offer;
      if (offer !== null && offer.status === 'open' && !seen.has(offer.token)) {
        announce(offerArrivedAnnouncement(offer.label));
      }
    }
  }, [announce]);

  useEffect(() => {
    void check();
  }, [check]);

  useLiveUpdates({}, () => {
    void check();
  });
}

export function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  const { message } = useAnnouncer();
  useOfferArrivals();

  return (
    <div className="page">
      <header className="top-bar">
        <span className="wordmark">Halyard Hall</span>
        <nav aria-label="Box office">
          <Link to="/">Programme</Link>
          <Link to="/tickets">My tickets</Link>
        </nav>
      </header>
      <div role="status" aria-label="Box office updates" aria-live="polite" className="visually-hidden">
        {message}
      </div>
      <main>{children}</main>
    </div>
  );
}
