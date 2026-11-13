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

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** HH:MM today in the viewer's zone, otherwise D Mon HH:MM. */
export function formatTime(iso: string, now = new Date()): string {
  const value = new Date(iso);
  const clock = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  if (sameDay(value, now)) return clock;
  return `${value.getDate()} ${MONTHS[value.getMonth()] as string} ${clock}`;
}

/** D Mon YYYY in the viewer's zone. */
export function formatDate(iso: string): string {
  const value = new Date(iso);
  return `${value.getDate()} ${MONTHS[value.getMonth()] as string} ${value.getFullYear()}`;
}

/** The letter's first line, cut to 80 characters. */
export function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > 80 ? line.slice(0, 80) : line;
}

export function countCodePoints(text: string): number {
  return [...text].length;
}
