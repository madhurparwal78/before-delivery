import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface LiveApi {
  announceStatus: (text: string) => void;
  announceError: (text: string) => void;
  startAction: () => void;
}

interface LiveState extends LiveApi {
  status: string;
  error: string;
}

const LiveContext = createContext<LiveState | null>(null);

function inALaterFrame(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

export function LiveProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Each announcement empties both regions first, so a later announcement must be able to
  // cancel the deferred write of an earlier one.
  const generation = useRef(0);

  const api = useMemo<LiveApi>(
    () => ({
      announceStatus: (text) => {
        const mine = (generation.current += 1);
        setStatus('');
        setError('');
        inALaterFrame(() => {
          if (generation.current === mine) setStatus(text);
        });
      },
      announceError: (text) => {
        const mine = (generation.current += 1);
        setStatus('');
        setError('');
        inALaterFrame(() => {
          if (generation.current === mine) setError(text);
        });
      },
      startAction: () => {
        generation.current += 1;
        setError('');
      },
    }),
    [],
  );

  const value = useMemo<LiveState>(() => ({ ...api, status, error }), [api, status, error]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** The two live regions are part of the page shell and are never removed or re-inserted. */
export function LiveRegionsView(): ReactNode {
  const live = useContext(LiveContext);
  if (live === null) throw new Error('Live regions are missing from the page shell');
  return (
    <div className="live-regions">
      <span className="status" role="status" aria-live="polite" aria-label="Action status">
        {live.status}
      </span>
      <span className="alert" role="alert" aria-label="Action error">
        {live.error}
      </span>
    </div>
  );
}

export function useLive(): LiveApi {
  const live = useContext(LiveContext);
  if (live === null) throw new Error('Live regions are missing from the page shell');
  return live;
}
