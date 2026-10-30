import { festivalDayLabel, offsetMinutesAt, resolveLocalTime, wallClockAt } from '../lib/time.js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** True inside the repeated hour of a clock change, where one wall time has two instants. */
export function wallTimeRepeats(instant: Date): boolean {
  const wall = wallClockAt(instant);
  const text = `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(
    wall.minute,
  )}`;
  const withSummer = resolveLocalTime(`${text}+02:00`);
  const withWinter = resolveLocalTime(`${text}+01:00`);
  return typeof withSummer !== 'string' && typeof withWinter !== 'string';
}

function zoneSuffix(instant: Date): string {
  if (!wallTimeRepeats(instant)) return '';
  return offsetMinutesAt(instant) === 120 ? ' CEST' : ' CET';
}

/** Brussels wall time "HH:MM", 24-hour. */
export function formatTime(instant: Date): string {
  const wall = wallClockAt(instant);
  return `${pad2(wall.hour)}:${pad2(wall.minute)}${zoneSuffix(instant)}`;
}

/** "Ddd D Mon, HH:MM" in Brussels time. */
export function formatDeadline(instant: Date): string {
  const wall = wallClockAt(instant);
  const label = festivalDayLabelOf(instant);
  return `${label}, ${pad2(wall.hour)}:${pad2(wall.minute)}${zoneSuffix(instant)}`;
}

function festivalDayLabelOf(instant: Date): string {
  const wall = wallClockAt(instant);
  return festivalDayLabel(`${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`);
}

/** "D Mon YYYY". */
export function formatDate(instant: Date): string {
  const wall = wallClockAt(instant);
  return `${wall.day} ${MONTHS[wall.month - 1] as string} ${wall.year}`;
}

export function formatDayLabel(date: string): string {
  return festivalDayLabel(date);
}

/** "Ddd D Mon · HH:MM–HH:MM". */
export function formatSessionWhen(startsAt: Date, endsAt: Date): string {
  return `${festivalDayLabelOf(startsAt)} \u00b7 ${formatTime(startsAt)}\u2013${formatTime(endsAt)}`;
}
