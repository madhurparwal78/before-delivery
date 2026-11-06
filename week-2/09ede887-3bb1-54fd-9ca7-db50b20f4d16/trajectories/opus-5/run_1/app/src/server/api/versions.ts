export type ApiVersion = 'v1' | 'v2';

export const SUNSET_HEADER = 'Sat, 31 Oct 2026 16:00:00 GMT';

export const FORMAT_LABELS: Readonly<Record<string, string>> = {
  'demo-qa': 'Demo + Q&A',
  fireside: 'Fireside',
  game: 'Game',
  keynote: 'Keynote',
  panel: 'Panel',
  workshop: 'Workshop',
};

export function formatLabel(format: string | null): string | null {
  return format === null ? null : FORMAT_LABELS[format] ?? null;
}
