const pad = (value: number) => String(value).padStart(2, '0');

export function clockText(seconds: number): string {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

export function durationText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

export function parseClock(text: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}
