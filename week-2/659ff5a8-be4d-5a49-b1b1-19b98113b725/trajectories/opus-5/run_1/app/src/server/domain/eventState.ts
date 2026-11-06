import type { EventStatus } from '../../shared/api';

const TRANSITIONS: Record<EventStatus, EventStatus | null> = {
  draft: 'registration_open',
  registration_open: 'registration_closed',
  registration_closed: 'running',
  running: 'provisional',
  provisional: 'final',
  final: null,
  published: null,
};

export const EVENT_STATUSES: EventStatus[] = [
  'draft',
  'registration_open',
  'registration_closed',
  'running',
  'provisional',
  'final',
  'published',
];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as string[]).includes(value);
}

/** The one place the event state machine is decided. */
export function isLegalTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from] === to;
}

/**
 * The status the event reports. A `registration_open` event whose cutoff has passed
 * reports itself closed without anyone acting.
 */
export function reportedStatus(
  storedStatus: EventStatus,
  registrationCutoffUtc: Date,
  now: Date,
): EventStatus {
  if (storedStatus === 'registration_open' && now.getTime() >= registrationCutoffUtc.getTime()) {
    return 'registration_closed';
  }
  return storedStatus;
}

export function isRegistrationOpen(
  storedStatus: EventStatus,
  registrationCutoffUtc: Date,
  now: Date,
): boolean {
  return (
    storedStatus === 'registration_open' && now.getTime() < registrationCutoffUtc.getTime()
  );
}

export function isProtestWindowOpen(protestWindowClosesAt: Date | null, now: Date): boolean {
  return protestWindowClosesAt !== null && now.getTime() < protestWindowClosesAt.getTime();
}

export function isRotaOpen(status: EventStatus): boolean {
  return status === 'registration_open' || status === 'registration_closed' || status === 'running';
}

export function isCheckInOpen(status: EventStatus): boolean {
  return status === 'registration_closed' || status === 'running';
}

export function isWithdrawalOpen(status: EventStatus): boolean {
  return status === 'registration_open' || status === 'registration_closed';
}

export function areResultsLocked(status: EventStatus): boolean {
  return status === 'final' || status === 'published';
}

export function isEditable(status: EventStatus): boolean {
  return status === 'draft';
}
