import type { LuxStatus } from '../../shared/types';

export interface LuxInputs {
  plannedLux: number;
  plannedLuxHours: number;
  luxLimit: number;
  luxHourBudget: number;
}

/** Planned lux-hours: the wall's planned lux across the exhibition's open hours. */
export function computePlannedLuxHours(plannedLux: number, openHours: number): number {
  return plannedLux * openHours;
}

export function computeLuxStatus(inputs: LuxInputs): LuxStatus {
  const overLux = inputs.plannedLux > inputs.luxLimit;
  const overBudget = inputs.plannedLuxHours > inputs.luxHourBudget;
  return overLux || overBudget ? 'over' : 'within';
}
