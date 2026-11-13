// The server clock governs invitation expiry, rate limits and match dates.
// The pen grace uses elapsed time, which the clock route does not change.

let offsetMs: number | null = null;

export const now = (): Date => (offsetMs === null ? new Date() : new Date(Date.now() + offsetMs));

export const elapsed = (): number => Date.now();

export const setClock = (iso: string | null): Date => {
  if (iso === null) {
    offsetMs = null;
  } else {
    const target = new Date(iso);
    offsetMs = target.getTime() - Date.now();
  }
  return now();
};
