const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates read like `Sat 24 Oct`, in the workspace calendar, never the device's. */
export function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${weekdays[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${months[parsed.getUTCMonth()]}`;
}

export function shortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getUTCDate()} ${months[parsed.getUTCMonth()]}`;
}

/** The date part of a server instant, which already carries the workspace offset. */
export function dateOfInstant(instant: string): string {
  return instant.slice(0, 10);
}

export function timeOfInstant(instant: string): string {
  return instant.slice(11, 16);
}
