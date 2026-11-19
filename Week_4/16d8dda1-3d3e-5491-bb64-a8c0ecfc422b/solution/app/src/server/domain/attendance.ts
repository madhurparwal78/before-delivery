// Attendance: the one decision of a learner's mark from server presence times.
import type { AttendanceStatus } from '../../shared/wire';

interface Interval {
  joinedMs: number;
  leftMs: number | null;
}

interface AttendanceRules {
  graceMs: number;
  lateAfterMs: number;
  leftEarlyMs: number;
}

interface Attendance {
  status: AttendanceStatus;
  firstJoinedMs: number | null;
  lastLeftMs: number | null;
  visits: number;
}

export function attendanceOf(intervals: Interval[], startMs: number, endMs: number, rules: AttendanceRules): Attendance {
  if (intervals.length === 0) return { status: 'absent', firstJoinedMs: null, lastLeftMs: null, visits: 0 };
  const sorted = intervals
    .map((interval) => ({ joinedMs: interval.joinedMs, leftMs: Math.min(interval.leftMs ?? endMs, endMs) }))
    .sort((a, b) => a.joinedMs - b.joinedMs);
  const visits: { joinedMs: number; leftMs: number }[] = [];
  for (const interval of sorted) {
    const last = visits[visits.length - 1];
    if (last && interval.joinedMs - last.leftMs < rules.graceMs) last.leftMs = Math.max(last.leftMs, interval.leftMs);
    else visits.push({ ...interval });
  }
  const firstJoinedMs = visits[0]?.joinedMs ?? 0;
  const lastLeftMs = visits[visits.length - 1]?.leftMs ?? 0;
  const late = firstJoinedMs > startMs + rules.lateAfterMs;
  const leftEarly = lastLeftMs < endMs - rules.leftEarlyMs;
  const status: AttendanceStatus = late ? (leftEarly ? 'late_left_early' : 'late') : leftEarly ? 'left_early' : 'present';
  return { status, firstJoinedMs, lastLeftMs, visits: visits.length };
}
