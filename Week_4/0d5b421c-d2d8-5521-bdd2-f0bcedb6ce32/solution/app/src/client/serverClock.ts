// Countdowns run to the server's expiry instant, corrected by the offset between the server's clock and this device's.
let offsetMs = 0;

export function syncServerClock(serverNowIso: string): void {
  offsetMs = Date.parse(serverNowIso) - Date.now();
}

/** The server's now, as far as this device can tell. Used only to draw countdowns. */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

export function secondsLeft(expiresAtIso: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAtIso) - serverNowMs()) / 1000));
}

export function formatMinutesSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
