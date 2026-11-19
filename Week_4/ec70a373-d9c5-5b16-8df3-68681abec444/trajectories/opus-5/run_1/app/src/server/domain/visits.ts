import { iso } from '../clock';
import { query } from '../db';
import { gapFlagged, gapHours, isOverdue } from './rules';
import { localDateOf, localTimeOf } from '../../shared/tz';
import { SERVICE_LABELS, type ServiceCode, type VisitJson } from '../../shared/types';
import type { TruckRecord } from './members';

export interface VisitRow {
  id: string;
  truck_id: string;
  site_id: string;
  arrived_at: Date;
  departed_at: Date | null;
  services: ServiceCode[];
  operator_signature: string;
  manager_name: string;
}

export interface VisitLog {
  visits: VisitJson[];
  lastDepartedAtMs: number | null;
  overdue: boolean;
}

/** Every visit of a truck, newest first, with its gap worked out from the departures. */
export async function visitLog(truckId: string, atMs: number): Promise<VisitLog> {
  const rows = await query<VisitRow>(
    `select id, truck_id, site_id, arrived_at, departed_at, services, operator_signature,
            manager_name
       from visits where truck_id = $1 order by arrived_at asc, id asc`,
    [truckId],
  );
  const json: VisitJson[] = [];
  let previousDeparted: number | null = null;
  for (const row of rows) {
    const departed = row.departed_at === null ? null : row.departed_at.getTime();
    let gap: number | null = null;
    if (departed !== null && previousDeparted !== null) {
      gap = gapHours(previousDeparted, departed);
    }
    json.push({
      id: row.id,
      truck_id: row.truck_id,
      site_id: row.site_id,
      arrived_at: iso(row.arrived_at),
      departed_at: row.departed_at === null ? null : iso(row.departed_at),
      services: row.services,
      operator_signature: row.operator_signature,
      manager_name: row.manager_name,
      gap_hours: gap,
      gap_flagged: gap !== null && gapFlagged(gap),
    });
    if (departed !== null) previousDeparted = departed;
  }
  json.reverse();
  return {
    visits: json,
    lastDepartedAtMs: previousDeparted,
    overdue: isOverdue(previousDeparted, atMs),
  };
}

export function gapCellText(visit: { gap_hours: number | null; gap_flagged: boolean }): string {
  if (visit.gap_hours === null) return '—';
  const hours = visit.gap_hours.toFixed(2);
  return visit.gap_flagged ? `Gap ${hours} h — over 24 hours` : `${hours} h`;
}

/** The visit-log snapshot: only the fields an inspector copy may carry. */
export function visitLogPdfLines(truck: TruckRecord, log: VisitLog): string[] {
  const lines = [
    `${truck.name} commissary visits`,
    `Permit number: ${truck.permit_number}`,
    `Operator: ${truck.business_name}`,
    `Commissary: ${truck.site_name}, ${truck.site_address}`,
    `Time zone: ${truck.time_zone}`,
    '',
  ];
  for (const visit of log.visits) {
    const arrived = `${localDateOf(truck.time_zone, Date.parse(visit.arrived_at))} ${localTimeOf(
      truck.time_zone,
      Date.parse(visit.arrived_at),
    )}`;
    const departed =
      visit.departed_at === null
        ? '—'
        : `${localDateOf(truck.time_zone, Date.parse(visit.departed_at))} ${localTimeOf(
            truck.time_zone,
            Date.parse(visit.departed_at),
          )}`;
    const services = visit.services
      .map((service) => SERVICE_LABELS[service])
      .join(', ');
    lines.push(
      `Arrived ${arrived} | Departed ${departed} | Services: ${services || '—'} | ` +
        `Operator signature: ${visit.operator_signature} | Manager: ${visit.manager_name} | ` +
        `Gap: ${gapCellText(visit)}`,
    );
  }
  return lines;
}
