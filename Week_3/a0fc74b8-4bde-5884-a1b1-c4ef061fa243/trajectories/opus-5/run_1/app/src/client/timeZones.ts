const FALLBACK: readonly string[] = [
  'UTC',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Pacific/Auckland',
];

export const timeZoneNames = (): string[] => {
  let names: string[] = [...FALLBACK];
  try {
    const supported = Intl.supportedValuesOf('timeZone');
    if (supported.length > 0) names = ['UTC', ...supported.filter((zone) => zone !== 'UTC')];
  } catch {
    names = [...FALLBACK];
  }
  return names;
};

/** Renders an instant in the document's time zone as `YYYY-MM-DD HH:MM`. */
export const stampInZone = (iso: string, timeZone: string): string => {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const find = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = find('hour') === '24' ? '00' : find('hour');
  return `${find('year')}-${find('month')}-${find('day')} ${hour}:${find('minute')}`;
};
