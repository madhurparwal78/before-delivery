import type { ReactNode } from 'react';
import type { LaneView } from '../lib/hooks';
import { STATUS_LABELS } from '../lib/format';

export function SeatLane({ lane }: { lane: LaneView }): ReactNode {
  const held = lane.status !== 'open';
  return (
    <div className={`lane ${held ? lane.status : 'open'}`} role="group" aria-label={`Seat ${lane.seat}`}>
      {lane.fill === 'none' ? null : (
        <span className={`lane-fill ${lane.fill}`} aria-hidden="true" />
      )}
      {/* An offer card never learns who holds a seat, so it says `covered` instead. */}
      <span className="lane-label">{held ? (lane.initials ?? 'covered') : 'open'}</span>
    </div>
  );
}

export function AllCoveredMark(): ReactNode {
  return (
    <span role="img" aria-label="All seats covered" className="verified-mark">
      ✓
    </span>
  );
}

export function StatusLabel({ status }: { status: string }): ReactNode {
  return <span className="status-label">{STATUS_LABELS[status] ?? status}</span>;
}

export function coveredCount(lanes: readonly LaneView[]): string {
  const covered = lanes.filter((lane) => lane.status !== 'open').length;
  return `${covered} of ${lanes.length} covered`;
}

export function allCovered(lanes: readonly LaneView[]): boolean {
  return lanes.length > 0 && lanes.every((lane) => lane.status !== 'open');
}
