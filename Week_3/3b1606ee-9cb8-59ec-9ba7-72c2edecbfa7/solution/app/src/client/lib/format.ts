const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (value: number): string => String(value).padStart(2, '0');

/** `HH:MM` for today in the viewer's zone, otherwise `D Mon HH:MM`. */
export function formatTime(iso: string): string {
  const when = new Date(iso);
  const today = new Date();
  const clock = `${two(when.getHours())}:${two(when.getMinutes())}`;
  const sameDay = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate();
  return sameDay ? clock : `${when.getDate()} ${MONTHS[when.getMonth()]} ${clock}`;
}

/** `D Mon YYYY` in the viewer's zone. */
export function formatDate(iso: string): string {
  const when = new Date(iso);
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}

export const codePoints = (text: string): number => Array.from(text).length;

function cut(text: string, limit: number): string {
  const points = Array.from(text);
  return points.length > limit ? points.slice(0, limit).join('') : text;
}

/** The first line of a letter's text, cut to 80 characters. */
export function firstLine(text: string): string {
  return cut(text.split('\n')[0] ?? '', 80);
}

export function megabytes(bytes: number): string {
  return `${(Math.floor((bytes / 1_048_576) * 10) / 10).toFixed(1)} MB`;
}

export const uuid = (): string => crypto.randomUUID();

/** A file's size for its button: kilobytes under a megabyte, otherwise megabytes. */
export function fileSize(bytes: number): string {
  return bytes < 1_048_576 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}
