import type { SessionSnapshot } from '../shared/domain';
import type { SessionState } from './sessionEngine';
import { fastClockLabel } from '../shared/scaleUnits';

/** Build the published session snapshot shape from stored session pieces. */
export function snapshotOf(row: {
  id: string; name: string; status: string; hold_reason: string | null; ratio: number;
  revision: number; control_revision: number; session_version: number; tick: number;
  fast_clock_seconds: number; layout_version_id: string; layout_version_number: number;
  timetable_version: number; state: SessionState;
}): SessionSnapshot {
  return {
    id: row.id,
    name: row.name,
    status: row.status as SessionSnapshot['status'],
    hold_reason: row.hold_reason as SessionSnapshot['hold_reason'],
    ratio: Number(row.ratio),
    revision: Number(row.revision),
    control_revision: Number(row.control_revision),
    session_version: Number(row.session_version),
    tick: Number(row.tick),
    fast_clock_seconds: Number(row.fast_clock_seconds),
    fast_clock_label: fastClockLabel(Number(row.fast_clock_seconds)),
    layout_version_id: row.layout_version_id,
    layout_version_number: Number(row.layout_version_number),
    timetable_version: Number(row.timetable_version),
    trains: row.state.trains,
    blocks: row.state.blocks,
    turnouts: row.state.turnouts,
    authorities: row.state.authorities,
    conflicts: row.state.conflicts,
    deadlocks: row.state.deadlocks,
    timetable_progress: row.state.timetable_progress,
    counters: row.state.counters,
  };
}
