/** The polite and assertive live regions, and the refusal copy they carry. */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Announcer {
  /** Starts an action: the pending copy replaces anything the regions held. */
  startPending: (message: string) => void;
  say: (message: string) => void;
  problem: (message: string) => void;
  clear: () => void;
  announcement: string;
  problemMessage: string;
}

const AnnouncerContext = createContext<Announcer | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [announcement, setAnnouncement] = useState('');
  const [problemMessage, setProblemMessage] = useState('');

  const startPending = useCallback((message: string) => {
    setProblemMessage('');
    setAnnouncement(message);
  }, []);
  // A success line never clears a refusal: a batch can report both at once.
  const say = useCallback((message: string) => setAnnouncement(message), []);
  const problem = useCallback((message: string) => {
    setAnnouncement('');
    setProblemMessage(message);
  }, []);
  const clear = useCallback(() => {
    setAnnouncement('');
    setProblemMessage('');
  }, []);

  const value = useMemo<Announcer>(
    () => ({ startPending, say, problem, clear, announcement, problemMessage }),
    [startPending, say, problem, clear, announcement, problemMessage],
  );

  return <AnnouncerContext.Provider value={value}>{children}</AnnouncerContext.Provider>;
}

export function useAnnouncer(): Announcer {
  const value = useContext(AnnouncerContext);
  if (!value) throw new Error('Announcements are only available inside AnnouncerProvider');
  return value;
}

export function LiveRegions({ scope }: { scope: 'office' | 'public' }): JSX.Element {
  const { announcement, problemMessage } = useAnnouncer();
  const statusName = scope === 'public' ? 'Site announcements' : 'Announcements';
  const alertName = scope === 'public' ? 'Site problems' : 'Problems';
  return (
    <>
      <div role="status" aria-label={statusName} aria-live="polite" className="live-region">
        {announcement}
      </div>
      <div role="alert" aria-label={alertName} aria-live="assertive" className="live-region">
        {problemMessage}
      </div>
    </>
  );
}
