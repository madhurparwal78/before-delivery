import type { WorkspaceState } from '../../shared/types.js';

export const STATE_EVENT_TYPES = [
  'subscription.trial_converted',
  'payment.failed',
  'payment.succeeded',
  'subscription.cancelled',
] as const;

export const CALLBACK_TYPES = [...STATE_EVENT_TYPES, 'seats.changed'] as const;

export type StateEventType = (typeof STATE_EVENT_TYPES)[number];
export type CallbackType = (typeof CALLBACK_TYPES)[number];

export type StateStep = StateEventType | 'trial.ended';

export interface StateEvent {
  eventId: string;
  type: StateEventType;
  occurredAt: Date;
}

const TRANSITIONS: Record<WorkspaceState, Partial<Record<StateStep, WorkspaceState>>> = {
  trialing: {
    'subscription.trial_converted': 'active',
    'trial.ended': 'read_only',
    'subscription.cancelled': 'cancelled',
  },
  active: {
    'payment.failed': 'past_due',
    'subscription.cancelled': 'cancelled',
  },
  past_due: {
    'payment.succeeded': 'active',
    'payment.failed': 'read_only',
    'subscription.cancelled': 'cancelled',
  },
  read_only: {
    'payment.succeeded': 'active',
    'subscription.trial_converted': 'active',
    'subscription.cancelled': 'cancelled',
  },
  cancelled: {},
};

export function isStateEventType(type: string): type is StateEventType {
  return (STATE_EVENT_TYPES as readonly string[]).includes(type);
}

export function isCallbackType(type: string): type is CallbackType {
  return (CALLBACK_TYPES as readonly string[]).includes(type);
}

interface ReplayStep {
  step: StateStep;
  occurredAt: Date;
  eventId: string;
}

export interface ReplayResult {
  state: WorkspaceState;
  appliedEventIds: Set<string>;
}

const TRIAL_END_EVENT_ID = '\u0000trial.ended';

/**
 * The workspace state is always the replay, from trialing, of every stored state event in
 * occurredAt order (ties broken by eventId), with the trial-end trigger placed at
 * trialEndsAt once that instant has passed.
 */
export function replaySubscription(
  events: StateEvent[],
  trialEndsAt: Date,
  now: Date,
): ReplayResult {
  const steps: ReplayStep[] = events.map((event) => ({
    step: event.type,
    occurredAt: event.occurredAt,
    eventId: event.eventId,
  }));
  if (trialEndsAt.getTime() <= now.getTime()) {
    steps.push({ step: 'trial.ended', occurredAt: trialEndsAt, eventId: TRIAL_END_EVENT_ID });
  }
  steps.sort(
    (left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0),
  );

  let state: WorkspaceState = 'trialing';
  const appliedEventIds = new Set<string>();
  for (const entry of steps) {
    const next: WorkspaceState | undefined = TRANSITIONS[state][entry.step];
    if (next !== undefined) {
      state = next;
      appliedEventIds.add(entry.eventId);
    }
  }
  return { state, appliedEventIds };
}

export function isWritable(state: WorkspaceState): boolean {
  return state === 'trialing' || state === 'active' || state === 'past_due';
}
