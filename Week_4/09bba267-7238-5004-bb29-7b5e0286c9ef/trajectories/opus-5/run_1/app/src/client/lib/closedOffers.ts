const STORAGE_KEY = 'seatwise.offers.closed-here';

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Remembers that this browser accepted or declined an offer, so its other tabs stay silent. */
export function rememberClosedHere(token: string): void {
  const tokens = read();
  if (tokens.includes(token)) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...tokens.slice(-50), token]));
}

export function wasClosedHere(token: string): boolean {
  return read().includes(token);
}
