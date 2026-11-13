import {
  dataNumber,
  formatDuration,
  formatIf,
  formatPace,
  formatPercent,
  formatTsb,
  formatTss,
  formatWatts,
} from '../domain/display.js';
import { formatDay, formatLongDay, formatMonday } from '../domain/time.js';
import { COMPLIANCE_LABELS } from '../domain/types.js';
import type { ComplianceState, Item } from '../domain/types.js';

export {
  dataNumber,
  formatDay,
  formatDuration,
  formatIf,
  formatLongDay,
  formatMonday,
  formatPace,
  formatPercent,
  formatTsb,
  formatTss,
  formatWatts,
};

export function complianceLabel(state: ComplianceState): string {
  return COMPLIANCE_LABELS[state];
}

export function itemTitle(item: Item): string {
  return (item.completed ?? item.planned)?.title ?? '';
}

export function itemWorkoutId(item: Item): string {
  return (item.completed ?? item.planned)?.id ?? '';
}

export function itemTss(item: Item): number | null {
  if (item.completed?.tss !== null && item.completed?.tss !== undefined) return item.completed.tss;
  return item.planned?.planned_tss ?? null;
}

export function itemDurationS(item: Item): number {
  return (item.completed ?? item.planned)?.duration_s ?? 0;
}
