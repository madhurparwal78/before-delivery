import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.js';
import { statusLabel } from '../../shared/status.js';
import type { ClusterStatus, ReviewLinkState } from '../../shared/types.js';

export function LiveRegion({ name, message }: { name: string; message: string }): JSX.Element {
  return (
    <div className="live-region" role="status" aria-label={name} aria-live="polite">
      {message}
    </div>
  );
}

/** Counts roll, with the old digits sliding out and the new ones in. */
export function RollingCount({ value, suffix }: { value: number; suffix?: string }): JSX.Element {
  const [rolling, setRolling] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setRolling(true);
      const timer = setTimeout(() => setRolling(false), 180);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [value]);

  return (
    <span className={rolling ? 'roll rolling' : 'roll'}>
      <span>
        {value}
        {suffix ?? ''}
      </span>
    </span>
  );
}

const statusIcons: Record<ClusterStatus, IconName> = {
  draft: 'draft',
  in_review: 'review',
  embargoed: 'clock',
  public: 'live',
  withdrawn: 'blocked',
};

export function StatusLabel({ status, pending }: { status: ClusterStatus; pending: boolean }): JSX.Element {
  return (
    <div className="status-line" aria-label="Status" tabIndex={-1} id="cluster-status-label">
      <span className="tag">
        <Icon name={statusIcons[status]} />
        {statusLabel(status)}
      </span>
      {pending ? (
        <span className="saving-note">
          <PendingDot /> Saving
        </span>
      ) : null}
    </div>
  );
}

const linkIcons: Record<ReviewLinkState, IconName> = {
  live: 'live',
  expired: 'clock',
  revoked: 'blocked',
  inactive: 'dormant',
};

const linkWords: Record<ReviewLinkState, string> = {
  live: 'Live',
  expired: 'Expired',
  revoked: 'Revoked',
  inactive: 'Inactive',
};

export function ReviewLinkTag({ state }: { state: ReviewLinkState }): JSX.Element {
  return (
    <span className="tag">
      <Icon name={linkIcons[state]} />
      {linkWords[state]}
    </span>
  );
}

export function SeatStateTag({ used, cap }: { used: number; cap: number }): JSX.Element {
  const state = used > cap ? 'Over cap' : used === cap ? 'Full' : 'Seats free';
  const icon: IconName = used > cap ? 'warning' : used === cap ? 'live' : 'dormant';
  return (
    <span className="tag">
      <Icon name={icon} />
      {state}
    </span>
  );
}

export function PendingDot(): JSX.Element {
  return <span className="pending-dot" aria-hidden="true" />;
}
