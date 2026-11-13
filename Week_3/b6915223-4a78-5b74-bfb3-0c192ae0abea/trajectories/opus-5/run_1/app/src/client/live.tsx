import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type RegionName =
  | 'Account'
  | 'Team updates'
  | 'Live points'
  | 'League updates'
  | 'History updates'
  | 'Operator updates'
  | 'Notices';

interface Announcement {
  text: string;
  seq: number;
}

interface LiveContextValue {
  announcements: Partial<Record<RegionName, Announcement>>;
  announce: (region: RegionName, text: string) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export const LiveProvider = ({ children }: { children: React.ReactNode }) => {
  const [announcements, setAnnouncements] = useState<
    Partial<Record<RegionName, Announcement>>
  >({});
  const counter = useRef(0);

  const announce = useCallback((region: RegionName, text: string) => {
    counter.current += 1;
    const seq = counter.current;
    setAnnouncements((current) => ({ ...current, [region]: { text, seq } }));
  }, []);

  const value = useMemo(() => ({ announcements, announce }), [announcements, announce]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
};

export const useAnnounce = (): ((region: RegionName, text: string) => void) => {
  const context = useContext(LiveContext);
  if (context === null) throw new Error('Live regions are not mounted');
  return context.announce;
};

export const LiveRegion = ({ name }: { name: RegionName }) => {
  const context = useContext(LiveContext);
  if (context === null) throw new Error('Live regions are not mounted');
  const announcement = context.announcements[name];
  return (
    <p
      role="status"
      aria-label={name}
      aria-live="polite"
      className="live-region"
      data-seq={announcement?.seq ?? 0}
    >
      {announcement?.text ?? ''}
    </p>
  );
};
