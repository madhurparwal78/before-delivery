const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (value: number) => String(value).padStart(2, '0');

const monthOf = (at: Date) => MONTHS[at.getMonth()] ?? '';

/** `HH:MM` in the viewer's local 24-hour time, with `D Mon` when the date differs. */
export function ledgerTime(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? clock : `${at.getDate()} ${monthOf(at)} ${clock}`;
}

/** `D Mon YYYY, HH:MM` in the viewer's local time. */
export function stamp(iso: string): string {
  const at = new Date(iso);
  return `${at.getDate()} ${monthOf(at)} ${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
