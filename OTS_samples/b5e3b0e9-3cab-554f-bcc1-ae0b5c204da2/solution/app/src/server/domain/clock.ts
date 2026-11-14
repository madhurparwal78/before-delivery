/** Sim time `HH:MM:SS` from seconds since midnight. */
export function simClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Seconds since midnight from `HH:MM:SS`, or null when the text is not a sim time. */
export function parseSimClock(text: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return h < 24 && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
}

/** A duration or timer `m:ss`. */
export function minutesSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
