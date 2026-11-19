import { useEffect, useRef, type ReactNode } from "react";
import { LiveRegion } from "../announce.js";
import { useDependencyStatus } from "../status.js";
import { AlertIcon } from "./Icons.js";

export const COPY = {
  holdsPaused: "Table holds are paused. Please try again in a few minutes.",
  depositsPaused: "Deposits are paused. Bookings that need a deposit can't be confirmed right now.",
  livePaused: "Live updates are paused. The plan refreshes every 30 seconds.",
  notFound: "We couldn't find that page.",
};

export function Banners({ host = false }: { host?: boolean }) {
  const { holdsPaused, depositsPaused } = useDependencyStatus();
  return (
    <div className="banners">
      {holdsPaused && (
        <div role="alert" className="banner">
          <AlertIcon />
          <span>{COPY.holdsPaused}</span>
        </div>
      )}
      {depositsPaused && (
        <div role="alert" className="banner">
          <AlertIcon />
          <span>{COPY.depositsPaused}</span>
        </div>
      )}
      {host && holdsPaused && (
        <div role="alert" className="banner">
          <AlertIcon />
          <span>{COPY.livePaused}</span>
        </div>
      )}
    </div>
  );
}

/** The pinned top line. Its height is published so dialogs sit entirely below it. */
function PinnedLine({ level, children }: { level: "h1" | "p"; children: ReactNode }) {
  const node = useRef<HTMLHeadingElement & HTMLParagraphElement>(null);
  useEffect(() => {
    const element = node.current;
    if (element === null) return undefined;
    const publish = (): void => document.documentElement.style.setProperty("--summary-bottom", `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const Tag = level;
  return (
    <Tag className="summary" ref={node}>
      {children}
    </Tag>
  );
}

export function Page({
  summary,
  summaryLevel = "h1",
  host = false,
  live,
  children,
  narrow = false,
}: {
  summary: ReactNode;
  summaryLevel?: "h1" | "p";
  host?: boolean;
  live?: { label: string; messages: { id: number; text: string }[] };
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <>
      <Banners host={host} />
      <PinnedLine level={summaryLevel}>{summary}</PinnedLine>
      <main className={narrow ? "page page-narrow" : "page"}>{children}</main>
      {live !== undefined && <LiveRegion label={live.label} messages={live.messages} />}
    </>
  );
}

/** Empty, loading and error states are each a single sentence in the large working size. */
export function OneSentence({ banners = true, children }: { banners?: boolean; children: ReactNode }) {
  return (
    <>
      {banners && <Banners />}
      <p className="sentence">{children}</p>
    </>
  );
}
