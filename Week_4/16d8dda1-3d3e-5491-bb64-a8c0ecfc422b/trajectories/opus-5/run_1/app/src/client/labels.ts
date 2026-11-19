import type { AttendanceStatus } from '../shared/types.js';

const labels: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  late_left_early: 'Late, left early',
  absent: 'Absent'
};

export function statusLabel(status: AttendanceStatus): string {
  return labels[status];
}
