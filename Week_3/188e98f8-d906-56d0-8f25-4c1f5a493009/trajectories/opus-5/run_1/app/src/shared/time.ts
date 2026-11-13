/** The one place the archive time-sent format and the countdown format are decided. */

/** `HH:MM:SS` of an ISO instant in UTC, truncated, never rounded. */
export function timeSent(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  const seconds = String(at.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/** `<m>:<ss>` of a whole number of seconds. */
export function clock(secondsLeft: number): string {
  const safe = secondsLeft > 0 ? secondsLeft : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
