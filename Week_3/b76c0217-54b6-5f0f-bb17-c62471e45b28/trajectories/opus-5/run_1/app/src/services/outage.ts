export type OutageService = 'storage' | 'mail';

const until: Record<OutageService, number> = { storage: 0, mail: 0 };

/** The grading outage route makes one service fail as if it were unreachable (DP-04). */
export function startOutage(service: OutageService, ms: number): Date {
  until[service] = Date.now() + ms;
  return new Date(until[service]);
}

export const isDown = (service: OutageService): boolean => Date.now() < until[service];
