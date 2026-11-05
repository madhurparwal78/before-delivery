import { useEffect, useState } from 'react';
import type { TrackingView } from '../../shared/types';
import { api } from '../api';
import { StatusLabel } from '../components/bits';

const DEAD_LINK = 'This tracking link is no longer active.';
const REFRESH_MS = 5000;

export function TrackScreen({ token }: { token: string }): JSX.Element {
  const [view, setView] = useState<TrackingView | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    const load = (): void => {
      api
        .get<TrackingView>(`/api/track/${token}`)
        .then((fresh) => {
          setView(fresh);
          setDead(false);
        })
        .catch(() => {
          setView(null);
          setDead(true);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [token]);

  if (dead) {
    return (
      <main>
        <div className="track-card">
          <p role="alert">{DEAD_LINK}</p>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main>
        <div className="track-card">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="track-card">
        <h1>Piece {view.piece_number}</h1>
        <p>
          <StatusLabel status={view.status} label={view.status_label} />
        </p>
        {view.pickup_shelf && <p className="mono">Pickup shelf {view.pickup_shelf}</p>}
      </div>
    </main>
  );
}
