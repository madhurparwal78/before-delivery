import type {
  AlertHistoryEntry,
  AlertState,
  LineStatus,
  MissionStatus,
  Role,
} from '../../shared/types.js';

export const SYSTEM_ACTOR = 'Swathdeck';

/** The mission edges, with the role that may ask for each. */
const MISSION_EDGES: { from: MissionStatus; to: MissionStatus; role: Role | 'server' }[] = [
  { from: 'Planned', to: 'Launched', role: 'principal_surveyor' },
  { from: 'Launched', to: 'Surveying', role: 'server' },
  { from: 'Surveying', to: 'Recovering', role: 'server' },
  { from: 'Recovering', to: 'Complete', role: 'launch_technician' },
  { from: 'Launched', to: 'Aborted', role: 'principal_surveyor' },
  { from: 'Surveying', to: 'Aborted', role: 'principal_surveyor' },
  { from: 'Recovering', to: 'Aborted', role: 'principal_surveyor' },
];

/** The one mission-transition decision for requests. Server-driven edges are never requestable. */
export function missionEdgeRequestable(
  from: MissionStatus,
  to: MissionStatus,
): { ok: true; role: Role } | { ok: false } {
  const edge = MISSION_EDGES.find((item) => item.from === from && item.to === to);
  if (!edge || edge.role === 'server') return { ok: false };
  return { ok: true, role: edge.role };
}

export function isMissionOpen(status: MissionStatus): boolean {
  return (
    status === 'Planned' || status === 'Launched' || status === 'Surveying' || status === 'Recovering'
  );
}

export function isMissionActive(status: MissionStatus): boolean {
  return status === 'Launched' || status === 'Surveying' || status === 'Recovering';
}

/** A line takes an assignment only while it is Pending or Assigned. */
export function lineAssignable(status: LineStatus): boolean {
  return status === 'Pending' || status === 'Assigned';
}

export function missionAssignable(status: MissionStatus): boolean {
  return status === 'Planned' || status === 'Launched' || status === 'Surveying';
}

/** A line counts as finished for the Recovering and Complete preconditions. */
export function lineFinished(status: LineStatus): boolean {
  return status === 'Surveyed' || status === 'Delivered' || status === 'Superseded';
}

export function lineRemaining(status: LineStatus): boolean {
  return status === 'Pending' || status === 'Assigned' || status === 'Running';
}

export type AlertTrigger = 'raise' | 'acknowledge' | 'clear';

/**
 * The one alert-transition decision, returning the history entry to append or
 * null when the state does not actually change.
 */
export function alertTransition(
  state: AlertState,
  trigger: AlertTrigger,
): { next: AlertState } | null {
  switch (trigger) {
    case 'raise':
      return { next: 'Active' };
    case 'acknowledge':
      if (state === 'Active') return { next: 'Acknowledged' };
      if (state === 'Rectified') return { next: 'Closed' };
      return null;
    case 'clear':
      if (state === 'Active') return { next: 'Rectified' };
      if (state === 'Acknowledged') return { next: 'Closed' };
      return null;
  }
}

export function historyEntry(state: AlertState, at: Date, by: string): AlertHistoryEntry {
  return { state, at: at.toISOString(), by };
}
