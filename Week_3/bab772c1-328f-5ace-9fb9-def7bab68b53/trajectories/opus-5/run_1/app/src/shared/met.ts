/** Mission elapsed time labels: `+DDD:HH:MM:SS`, or `T-DDD:HH:MM:SS` before the epoch. */

const MET_PATTERN = /^(\+|T-)(\d{3,}):(\d{2}):(\d{2}):(\d{2})$/;

/** `<met_label>` of whole MET seconds. */
export function formatMetLabel(seconds: number): string {
  const negative = seconds < 0;
  const total = Math.abs(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${negative ? "T-" : "+"}${pad(days, 3)}:${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}`;
}

/** Parses a typed MET label to whole seconds, or null when malformed. */
export function parseMetLabel(text: string): number | null {
  const match = MET_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const hours = Number(match[3]);
  const minutes = Number(match[4]);
  const seconds = Number(match[5]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const value = Number(match[2]) * 86400 + hours * 3600 + minutes * 60 + seconds;
  return match[1] === "T-" ? -value : value;
}
