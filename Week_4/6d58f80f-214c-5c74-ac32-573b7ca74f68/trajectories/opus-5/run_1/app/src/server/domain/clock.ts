/** America/Phoenix keeps UTC-7 all year round. */
const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

let offsetMs = 0;

export const serverNow = (): Date => new Date(Date.now() + offsetMs);

export const setServerNow = (target: Date): void => {
  offsetMs = target.getTime() - Date.now();
};

/** The company calendar date of an instant, written YYYY-MM-DD. */
export const companyDate = (at: Date): string =>
  new Date(at.getTime() + PHOENIX_OFFSET_MS).toISOString().slice(0, 10);

export const today = (): string => companyDate(serverNow());

/** The instant at which the company day `date` begins. */
export const startOfCompanyDay = (date: string): Date =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() - PHOENIX_OFFSET_MS);

export const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `from` to `to`, both company dates. */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );

export const isValidDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/** A dated entitlement is live through every instant of `endDate`; this is its edge. */
export const endOfDated = (endDate: string): Date => startOfCompanyDay(addDays(endDate, 1));

export const reached = (edge: Date): boolean => serverNow().getTime() >= edge.getTime();

export const clockBody = (): { now: string; today: string; zone: 'America/Phoenix' } => {
  const now = serverNow();
  return { now: now.toISOString(), today: companyDate(now), zone: 'America/Phoenix' };
};

