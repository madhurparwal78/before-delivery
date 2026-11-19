import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const REGION_NAMES = [
  "Sign-in status",
  "Save status",
  "Terrain updates",
  "Submit status",
  "Link status",
  "Upload status",
  "Review status",
  "View status",
] as const;

export type RegionName = (typeof REGION_NAMES)[number];

type Announce = (region: RegionName, text: string) => void;

const AnnounceContext = createContext<Announce>(() => undefined);

export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}

export function LiveRegions({ children }: { children: ReactNode }): ReactNode {
  const [messages, setMessages] = useState<Partial<Record<RegionName, string>>>({});
  const announce = useCallback<Announce>((region, text) => {
    setMessages((current) => ({ ...current, [region]: text }));
  }, []);
  const value = useMemo(() => announce, [announce]);

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div className="live-regions">
        {REGION_NAMES.map((name) => (
          <p
            key={name}
            role="status"
            aria-live="polite"
            aria-label={name}
            className={messages[name] ? "live-region live-region--filled" : "live-region"}
          >
            {messages[name] ?? ""}
          </p>
        ))}
      </div>
    </AnnounceContext.Provider>
  );
}
