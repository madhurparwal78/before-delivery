// The grading outage route makes every call to one service fail as if it were unreachable, for a while.

type OutageService = 'storage' | 'mail';

const until: Record<OutageService, number> = { storage: 0, mail: 0 };

export function startOutage(service: OutageService, ms: number): string {
  until[service] = Date.now() + ms;
  return new Date(until[service]).toISOString();
}

export function inOutage(service: OutageService): boolean {
  return Date.now() < until[service];
}
