import type { AttendanceStatus } from '../../shared/types.js';
import { config } from '../config.js';

export interface PresenceInterval {
  joinedAt: Date;
  leftAt: Date | null;
}

export interface AttendanceMark {
  status: AttendanceStatus;
  firstJoined: Date | null;
  lastLeft: Date | null;
  visits: number;
}

/** DP-27: gaps shorter than the reconnect grace join two intervals into one visit. */
export function joinVisits(
  intervals: PresenceInterval[],
  graceSeconds = config.reconnectGraceSeconds
): PresenceInterval[] {
  const graceMs = graceSeconds * 1_000;
  const sorted = [...intervals].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  const visits: PresenceInterval[] = [];
  for (const interval of sorted) {
    const previous = visits[visits.length - 1];
    if (previous === undefined) {
      visits.push({ joinedAt: interval.joinedAt, leftAt: interval.leftAt });
      continue;
    }
    if (previous.leftAt === null) {
      previous.leftAt = interval.leftAt;
      continue;
    }
    const gap = interval.joinedAt.getTime() - previous.leftAt.getTime();
    if (gap < graceMs) {
      previous.leftAt = interval.leftAt;
    } else {
      visits.push({ joinedAt: interval.joinedAt, leftAt: interval.leftAt });
    }
  }
  return visits;
}

/** DP-27: the one place an attendance mark is decided. */
export function markAttendance(
  intervals: PresenceInterval[],
  session: { startsAt: Date; endsAt: Date },
  graceSeconds?: number
): AttendanceMark {
  const visits = joinVisits(intervals, graceSeconds);
  const first = visits[0];
  if (first === undefined) {
    return { status: 'absent', firstJoined: null, lastLeft: null, visits: 0 };
  }
  const last = visits[visits.length - 1];
  const lastLeft = last === undefined ? null : last.leftAt;
  const lateEdge = session.startsAt.getTime() + config.lateAfterMinutes * 60_000;
  const earlyEdge = session.endsAt.getTime() - config.leftEarlyMinutes * 60_000;
  const late = first.joinedAt.getTime() > lateEdge;
  const leftEarly = lastLeft !== null && lastLeft.getTime() < earlyEdge;
  const status: AttendanceStatus = late
    ? leftEarly
      ? 'late_left_early'
      : 'late'
    : leftEarly
      ? 'left_early'
      : 'present';
  return { status, firstJoined: first.joinedAt, lastLeft, visits: visits.length };
}
