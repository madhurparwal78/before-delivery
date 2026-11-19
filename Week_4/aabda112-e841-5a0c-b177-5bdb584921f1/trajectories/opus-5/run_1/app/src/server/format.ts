import { clinicParts } from './clock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function clinicTimeHm(instant: number): string {
  const p = clinicParts(instant);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function clinicDayDdMon(instant: number): string {
  const p = clinicParts(instant);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]}`;
}

export function clinicDdMonYyyy(instant: number): string {
  const p = clinicParts(instant);
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function clinicDateDdMonYyyy(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

export function money(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const absolute = Math.abs(pence);
  const pounds = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, '0');
  return `${sign}£${pounds.toLocaleString('en-GB')}.${remainder}`;
}
