import type { Database } from './db.js';

/** Every workspace state transition in one place. */
export type WorkspaceState = 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled';

export const STATE_TRANSITIONS: Readonly<Record<string, Partial<Record<WorkspaceState, WorkspaceState>>>> = {
  'subscription.trial_converted': { trialing: 'active', read_only: 'active' },
  'payment.failed': { active: 'past_due', past_due: 'read_only' },
  'payment.succeeded': { past_due: 'active', read_only: 'active' },
  'subscription.cancelled': { trialing: 'cancelled', active: 'cancelled', past_due: 'cancelled', read_only: 'cancelled' },
};

export const WRITABLE_STATES: readonly WorkspaceState[] = ['trialing', 'active', 'past_due'];

export interface StateEventRow {
  readonly event_id: string;
  readonly type: string;
  readonly occurred_at: string;
}

export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly trial_ends_at: string;
  readonly trial_notice_sent_at: string | null;
  readonly created_at: string;
}

type Step = { key: string; type: string; at: number };

const stepKey = (s: Step): string => s.key;

/**
 * The single rule for a workspace's subscription state: replay every stored
 * state event in occurredAt order (ties by eventId ascending), plus the
 * trial-end trigger placed at trialEndsAt once that instant has passed.
 */
export function replayState(events: readonly StateEventRow[], trialEndsAt: Date, now: Date): WorkspaceState {
  const steps: Step[] = events
    .filter((e) => e.type !== 'seats.changed')
    .map((e) => ({ key: `e:${e.event_id}`, type: e.type, at: new Date(e.occurred_at).getTime() }));
  if (now.getTime() >= trialEndsAt.getTime()) {
    steps.push({ key: 't:~trial-end', type: 'trial.end', at: trialEndsAt.getTime() });
  }
  steps.sort((a, b) => a.at - b.at || (stepKey(a) < stepKey(b) ? -1 : stepKey(a) > stepKey(b) ? 1 : 0));

  let state: WorkspaceState = 'trialing';
  for (const step of steps) {
    if (step.type === 'trial.end') {
      if (state === 'trialing') state = 'read_only';
      continue;
    }
    const table: Partial<Record<WorkspaceState, WorkspaceState>> | undefined = STATE_TRANSITIONS[step.type];
    const next: WorkspaceState | undefined = table?.[state];
    if (next !== undefined) state = next;
  }
  return state;
}

/** Whether an event's own step changed the replay outcome, i.e. `applied`. */
export function eventApplied(events: readonly StateEventRow[], trialEndsAt: Date, now: Date, eventId: string): boolean {
  const without = replayState(events.filter((e) => e.event_id !== eventId), trialEndsAt, now);
  const withEvent = replayState(events, trialEndsAt, now);
  return without !== withEvent;
}

/** The newest seats.changed event by occurredAt then eventId, or null. */
export function newestSeatsEvent<E extends StateEventRow>(events: readonly E[], seatsOf: (e: E) => number | null): E | null {
  const seatEvents = events.filter((e) => e.type === 'seats.changed' && seatsOf(e) !== null);
  if (seatEvents.length === 0) return null;
  return [...seatEvents].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0),
  )[seatEvents.length - 1] ?? null;
}

export function workspaceLock(workspaceId: string): number {
  let h = 0;
  for (let i = 0; i < workspaceId.length; i++) {
    h = (h * 31 + workspaceId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2147483647;
}

/** Loads a workspace row or null. */
export async function loadWorkspace(db: Database, workspaceId: string): Promise<WorkspaceRow | null> {
  const rows = await db.query<WorkspaceRow>('SELECT id, name, state, trial_ends_at, trial_notice_sent_at, created_at FROM workspaces WHERE id = $1', [workspaceId]);
  return rows[0] ?? null;
}
