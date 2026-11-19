/**
 * The priority matrix with the business-critical bump. Every surface that shows
 * or recomputes a priority calls this.
 */

import { priorityLabels } from './fields';

const matrix: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 5 },
};

/** Priority from impact and urgency, raised one level for a business-critical item. */
export function priorityFrom(impact: number, urgency: number, businessCritical: boolean): number {
  const row = matrix[impact];
  const base = row ? row[urgency] : undefined;
  if (base === undefined) return 5;
  return businessCritical ? Math.max(1, base - 1) : base;
}

export function priorityLabel(priority: number): string {
  return priorityLabels[priority] ?? String(priority);
}

/** The label a priority group shows, for example `1 Critical`. */
export function priorityGroupLabel(priority: number): string {
  return `${priority} ${priorityLabel(priority)}`;
}

/** A change's read-only priority follows its risk band, or 1 when it is an emergency. */
export function changePriority(model: string, band: RiskBand | null): number {
  if (model === 'emergency') return 1;
  if (band === null) return 5;
  switch (band) {
    case 'Low':
      return 4;
    case 'Moderate':
      return 3;
    case 'High':
      return 2;
  }
}

export type RiskBand = 'Low' | 'Moderate' | 'High';
