import type { ReactNode } from 'react';
import { COPY } from '../lib/format';
import { useOutage } from '../lib/hooks';

export function OutageBanners({ extra }: { extra?: string | null }): JSX.Element {
  const outage = useOutage();
  return (
    <>
      {outage.holds === 'paused' ? (
        <div role="alert" className="banner">
          {COPY.holdsPaused}
        </div>
      ) : null}
      {outage.deposits === 'paused' ? (
        <div role="alert" className="banner">
          {COPY.depositsPaused}
        </div>
      ) : null}
      {extra ? (
        <div role="alert" className="banner">
          {extra}
        </div>
      ) : null}
    </>
  );
}

export function LiveRegion({ label, message }: { label: string; message: string }): JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="live-region">
      {message}
    </div>
  );
}

/** The pinned top line. Pages whose level 1 heading is published copy use `heading={false}`. */
export function PinnedTitle({
  children,
  heading = true,
}: {
  children: ReactNode;
  heading?: boolean;
}): JSX.Element {
  if (!heading) return <div className="pinned-title">{children}</div>;
  return <h1 className="pinned-title">{children}</h1>;
}
