export const LONDON = 'Europe/London';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  zone: 'GMT' | 'BST';
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hour12: false,
  timeZoneName: 'short',
});

/** Wall-clock parts of an instant in London, with the zone in force at that instant. */
export const londonParts = (instant: Date): LondonParts => {
  const map: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) map[part.type] = part.value;
  const weekdayIndex = WEEKDAYS.indexOf(map.weekday as (typeof WEEKDAYS)[number]);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayIndex,
    zone: map.timeZoneName === 'GMT' ? 'GMT' : 'BST',
  };
};

/** `14 Nov 2026, 10:30` in London. */
export const formatDateTime = (instant: Date | string): string => {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const p = londonParts(date);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)}`;
};

/** `Sat 14 Nov 2026, 10:30 GMT` in London. */
export const formatSlotLabel = (instant: Date | string): string => {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const p = londonParts(date);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)} ${p.zone}`;
};

export const londonZoneOf = (instant: Date | string): 'GMT' | 'BST' =>
  londonParts(typeof instant === 'string' ? new Date(instant) : instant).zone;

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** `£15,400`: whole pounds, a comma every three digits, no decimal part. */
export const formatPounds = (pounds: number): string => `£${Math.trunc(pounds).toLocaleString('en-GB')}`;

/** `47h 59m 12s left`, from the server's seconds alone, with whole hours uncapped. */
export const formatTimeLeft = (secondsRemaining: number): string => {
  const total = Math.max(0, Math.floor(secondsRemaining));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s left`;
};

/** `121 microns` or `4.8 mils`. */
export const formatGauge = (microns: number | null, mils: string | null, mode: 'microns' | 'mils'): string => {
  if (microns === null) return '';
  return mode === 'microns' ? `${microns} microns` : `${mils} mils`;
};

export const formatOdometer = (value: string | null, unit: string | null): string =>
  value === null || unit === null ? '' : `${Number(value).toLocaleString('en-GB')} ${unit === 'MI' ? 'miles' : 'km'}`;

/** `S4*****`: the first two characters of the stored registration, the rest asterisks. */
export const maskRegistration = (registration: string): string =>
  registration.slice(0, 2) + '*'.repeat(Math.max(0, registration.length - 2));

/** Microns divided by 25.4, rounded half up to one decimal. */
export const micronsToMils = (microns: number): string => {
  const scaled = (microns / 25.4) * 10;
  const rounded = Math.floor(scaled + 0.5);
  return (rounded / 10).toFixed(1);
};
