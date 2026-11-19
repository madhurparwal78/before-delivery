let clinicZone = 'Europe/London';

export function setClinicZone(zone: string): void {
  clinicZone = zone;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** Instants are read in clinic time, never in the browser's own zone. */
function parts(instant: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: clinicZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const found = formatter.formatToParts(new Date(instant));
  const read = (type: string): number => Number(found.find((part) => part.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
  };
}

export function hm(instant: string): string {
  const value = parts(instant);
  return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
}

export function minuteOfDay(instant: string): number {
  const value = parts(instant);
  return value.hour * 60 + value.minute;
}

export function clinicDateOf(instant: string): string {
  const value = parts(instant);
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

export function dayDdMon(instant: string): string {
  const value = parts(instant);
  const weekday = WEEKDAYS[new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay()];
  return `${weekday} ${String(value.day).padStart(2, '0')} ${MONTHS[value.month - 1]}`;
}

export function dateDdMonYyyy(clinicDate: string): string {
  const [year, month, day] = clinicDate.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

export function dateDayDdMonYyyy(clinicDate: string): string {
  const [year, month, day] = clinicDate.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

export function instantDdMonYyyy(instant: string): string {
  return dateDdMonYyyy(clinicDateOf(instant));
}

export function addDays(clinicDate: string, days: number): string {
  const [year, month, day] = clinicDate.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(
    moved.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function money(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const absolute = Math.abs(pence);
  const pounds = Math.floor(absolute / 100);
  return `${sign}£${pounds.toLocaleString('en-GB')}.${String(absolute % 100).padStart(2, '0')}`;
}
