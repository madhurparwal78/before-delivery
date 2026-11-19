const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Writes a timestamp as "6 November 2026 at 09:00 UTC". */
export function formatStamp(iso: string): string {
  const when = new Date(iso);
  const day = when.getUTCDate();
  const month = MONTHS[when.getUTCMonth()]!;
  const year = when.getUTCFullYear();
  const hours = String(when.getUTCHours()).padStart(2, '0');
  const minutes = String(when.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} at ${hours}:${minutes} UTC`;
}

export function countText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The Input and Output status format: "<bytes> bytes · <lines> lines". */
export function byteLineStatus(bytes: number, lines: number): string {
  return `${countText(bytes, 'byte', 'bytes')} · ${countText(lines, 'line', 'lines')}`;
}

const TTL_UNITS: Record<string, { seconds: number; singular: string; plural: string }> = {
  s: { seconds: 1, singular: 'second', plural: 'seconds' },
  m: { seconds: 60, singular: 'minute', plural: 'minutes' },
  h: { seconds: 3600, singular: 'hour', plural: 'hours' },
  d: { seconds: 86400, singular: 'day', plural: 'days' },
};

export interface TtlChoice {
  readonly code: string;
  readonly label: string;
  readonly seconds: number;
}

/** Reads a ttl code such as "1h" into its seconds and its label. */
export function parseTtl(code: string): TtlChoice | null {
  const match = /^(\d+)([smhd])$/.exec(code.trim());
  if (match === null) return null;
  const amount = Number(match[1]);
  const unit = TTL_UNITS[match[2]!]!;
  return {
    code: `${amount}${match[2]}`,
    label: countText(amount, unit.singular, unit.plural),
    seconds: amount * unit.seconds,
  };
}
