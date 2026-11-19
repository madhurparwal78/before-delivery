import { formatWhen } from '../shared/zone';

let businessZone = 'UTC';

export function setBusinessZone(zone: string): void {
  businessZone = zone;
}

/** Every time on screen uses the workspace's business time zone. */
export function when(instant: string | number | Date): string {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  return formatWhen(ms, businessZone);
}

export function zoneName(): string {
  return businessZone;
}
