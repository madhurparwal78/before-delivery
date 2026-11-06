import type { ReleaseStatus } from './types';

export type ReleaseAction = 'book' | 'stage' | 'complete' | 'cancel';

export const OPEN_RELEASE_STATUSES: readonly ReleaseStatus[] = ['requested', 'booked', 'staged'];

/** The single decision on which release moves are legal. */
export function releaseActionAllowed(
  status: ReleaseStatus,
  action: ReleaseAction,
  actor: 'owner' | 'staff',
): boolean {
  switch (action) {
    case 'book':
      return actor === 'staff' && status === 'requested';
    case 'stage':
      return actor === 'staff' && status === 'booked';
    case 'complete':
      return actor === 'staff' && status === 'staged';
    case 'cancel':
      return actor === 'staff'
        ? status === 'requested' || status === 'booked' || status === 'staged'
        : status === 'requested' || status === 'booked';
  }
}

export function releaseStatusAfter(action: ReleaseAction): ReleaseStatus {
  switch (action) {
    case 'book':
      return 'booked';
    case 'stage':
      return 'staged';
    case 'complete':
      return 'released';
    case 'cancel':
      return 'cancelled';
  }
}

export function isOpenRelease(status: ReleaseStatus): boolean {
  return OPEN_RELEASE_STATUSES.includes(status);
}

/** Release slots sit on the half hour, 08:00 to 17:30, Monday to Saturday. */
export const SLOT_FIRST_HOUR = 8;
export const SLOT_LAST_HOUR = 17;
export const SLOT_NOTICE_SECONDS = 48 * 60 * 60;

export function slotTimeOptions(): string[] {
  const options: string[] = [];
  for (let hour = SLOT_FIRST_HOUR; hour <= SLOT_LAST_HOUR; hour += 1) {
    options.push(`${String(hour).padStart(2, '0')}:00`);
    options.push(`${String(hour).padStart(2, '0')}:30`);
  }
  return options;
}
