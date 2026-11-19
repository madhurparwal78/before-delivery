// Record summary with the published row label and the shown SLA.

import { RouteContext } from '../api.js';
import { RecordSnapshot, stateLabel } from '../recordengine.js';
import { slaViews, shownSla } from '../slarunner.js';

export async function summaryWithSla(route: RouteContext, snap: RecordSnapshot): Promise<unknown> {
  const slas = await slaViews(route.ctx.db, snap.number);
  const shown = shownSla(slas);
  const type = snap.table === 'incident' ? 'Incident'
    : snap.table === 'problem' ? 'Problem'
    : snap.table === 'change' ? 'Change'
    : snap.table === 'request_item' ? 'Request item' : 'Task';
  const assignee = (snap.fields.assigned_to as string | null) ?? null;
  let sla: unknown = null;
  if (shown) {
    const remaining = shown.remaining_seconds;
    const percent = shown.percent;
    const state = shown.stage === 'paused' ? 'Paused'
      : shown.stage === 'completed' ? (shown.breached ? 'Missed' : 'Met')
      : shown.breached ? `Breached by ${hms(-remaining)}`
      : `${hms(remaining)} left`;
    sla = {
      percent,
      remaining_seconds: remaining,
      ticking: shown.ticking,
      next_change_at: shown.next_change_at,
      server_time: shown.server_time,
      stage: shown.stage,
      breached: shown.breached,
      label: `${type} ${snap.number}, priority ${snap.fields.priority ?? '?'}, ${stateLabel(snap.state)}, assigned to ${assignee ?? 'nobody'}, SLA ${percent} percent`,
    };
  }
  return {
    number: snap.number,
    table: snap.table,
    state: snap.state,
    state_label: stateLabel(snap.state),
    short_description: String(snap.fields.short_description ?? snap.fields.title ?? ''),
    priority: (snap.fields.priority as number | null) ?? null,
    assigned_to: assignee,
    sla,
    label: sla ? (sla as { label: string }).label : `${type} ${snap.number}, priority ${snap.fields.priority ?? '?'}, ${stateLabel(snap.state)}, assigned to ${assignee ?? 'nobody'}, no SLA`,
  };
}

/** Duration as H:MM:SS with whole hours and padded minutes and seconds. */
export function hms(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
