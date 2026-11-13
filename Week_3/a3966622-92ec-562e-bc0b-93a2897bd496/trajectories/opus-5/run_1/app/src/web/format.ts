import { clearanceCell, marginFromMm, metresFromMm, moneyFromCents } from '../domain/numerals.ts';
import type { PlanWaypoint } from './types.ts';

export { clearanceCell, marginFromMm, metresFromMm, moneyFromCents };

export function money(cents: number): string {
  return `$${moneyFromCents(cents)}`;
}

/** "<HH:MM> ADT" when the offset is -03:00 and "<HH:MM> AST" when it is -04:00. */
export function arrivalText(waypoint: PlanWaypoint): string {
  return `${waypoint.arrival_at.slice(11, 16)} ${zoneOf(waypoint.arrival_utc_offset)}`;
}

export function zoneOf(offset: string): string {
  return offset === '-03:00' ? 'ADT' : 'AST';
}

/** "<YYYY-MM-DD HH:MM> ADT" for a move's notice cutoff. */
export function cutoffText(cutoffAt: string, offset: string): string {
  return `${cutoffAt.slice(0, 16).replace('T', ' ')} ${zoneOf(offset)}`;
}

export function waterDepthMm(waypoint: PlanWaypoint): number {
  return waypoint.sounded_depth_mm + waypoint.tide_mm;
}

export function stepLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function minutesOfTime(text: string): number {
  const [hour, minute] = text.split(':');
  return Number(hour) * 60 + Number(minute);
}

export const NOTICE_ON_TIME = 'Notice on time - no cancellation charge';
export const NOTICE_LATE = "Under 2 hours' notice - cancellation charge applies";
export const LATE_CANCELLATION = "Cancelled late - under 2 hours' notice. The cancellation charge applies.";
export const LATE_AMENDMENT = "Late amendment - under 2 hours' notice. The cancellation charge applies.";
export const LADDER_REFUSED_HEADING = 'Boarding refused at ladder';
export const NO_REPLY = 'No reply from the server. Showing the last confirmed state.';
export const INVOICE_PENDING = 'Invoice pending provider confirmation';
export const FORMULA = 'Clearance = sounded depth + tide at arrival - draught - squat';

export const CHARGES_TEXT: Record<string, string> = {
  none: 'No charges',
  pending: 'Charges pending',
  posted: 'Charges posted',
};

export const SERVICE_COPY: Record<string, string> = {
  billing: 'Billing provider unreachable - charges and invoices are pending and will post automatically.',
  storage: 'Evidence store unreachable - photo uploads are paused until it returns.',
  mail: 'Mail service unreachable - notices are pending and will send automatically.',
};
