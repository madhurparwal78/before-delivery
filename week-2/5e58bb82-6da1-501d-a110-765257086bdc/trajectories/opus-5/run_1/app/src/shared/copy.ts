import { fixed, intervalText } from './numbers.js';
import type { MissionStatus } from './types.js';

/** Copy published once and used by both the server messages and the screens. */

export function overdueBlockMessage(
  vessel: string,
  hoursSinceService: number,
  serviceIntervalH: number,
): string {
  return `${vessel} is overdue for thruster service (${fixed(hoursSinceService, 1)} h since service, limit ${intervalText(serviceIntervalH)} h). Log a service before assigning or launching.`;
}

export function afloatServiceCopy(vessel: string): string {
  return `Recover ${vessel} before logging a service`;
}

export function staleVersionCopy(vessel: string): string {
  return `${vessel} was changed by someone else. Review the latest values and save again.`;
}

/** `<vessels>` is vessel names in alphabetical order, separated by a comma and a space. */
export function vesselList(names: string[]): string {
  return [...names].sort((a, b) => a.localeCompare(b, 'en')).join(', ');
}

export function notAfloatCopy(names: string[]): string {
  return `Not afloat yet: ${vesselList(names)}`;
}

export function recoverEveryVesselCopy(names: string[]): string {
  return `Recover every vessel before completing: ${vesselList(names)}`;
}

export function illegalMoveCopy(from: MissionStatus, to: MissionStatus): string {
  return `This mission cannot move from ${from} to ${to}`;
}

export function lineIllegalCopy(label: string, from: string, to: string): string {
  return `Line ${label} cannot move from ${from} to ${to}`;
}

export function vesselCommittedCopy(vessel: string, mission: string): string {
  return `${vessel} is already on ${mission}`;
}

export function notMissionOwnerCopy(owner: string, mission: string): string {
  return `Only ${owner} can do this for ${mission}.`;
}

export const EMPTY_HOLIDAY_COPY = 'No holidays — coverage is continuous';
export const REASSIGN_ONLY_COPY = 'Only pending or assigned lines can be reassigned';
export const MISSION_NOT_ASSIGNABLE_COPY = 'This mission no longer takes assignments';
export const LINES_UNASSIGNED_COPY = 'Assign every line and crossline before launching';
export const LINES_AWAITING_UPLOAD_COPY = 'Upload every line file before completing';
export const NOT_FOUND_HEADING = 'Page not found';
export const NOT_FOUND_TEXT = 'That page does not exist or is not shared with you.';
export const STORAGE_BANNER =
  'Line-file storage is unreachable — uploads are paused and will resume on their own.';
export const STORAGE_BACK = 'Line-file storage is back';
export const MAIL_BANNER = 'Alert email is delayed — alerts still show on this board.';
export const IDLE_SIGN_OUT_COPY = 'You were signed out after 30 minutes without activity.';
export const SIGN_IN_INCORRECT = 'Email or password is incorrect.';
export const REPORT_PENDING_COPY = 'Coverage report is being prepared';
export const UNKNOWN_VESSEL_COPY = 'No such vessel on this survey';
export const NO_HOLIDAY_UNDER_LENS = 'No holiday under the lens';
export const CHECKSUM_MISMATCH_COPY = 'Checksum does not match this file. Nothing was stored.';

export function alertHeading(
  kind: 'geofence_breach' | 'link_lost' | 'service_overdue',
  vessel: string,
): string {
  switch (kind) {
    case 'geofence_breach':
      return `Geofence breach — ${vessel}`;
    case 'link_lost':
      return `Link lost — ${vessel}`;
    case 'service_overdue':
      return `Service overdue — ${vessel}`;
  }
}
