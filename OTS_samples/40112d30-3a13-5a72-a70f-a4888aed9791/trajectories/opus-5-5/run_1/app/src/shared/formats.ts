const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `YYYY-MM-DD` to `14 Mar 2026`. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** `YYYY-MM-DD` to `14 March 2026`. */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`;
}

/** Local `YYYY-MM-DDTHH:MM` to `14 Mar 2026, 17:00`. */
export function formatLocalDateTime(local: string): string {
  return `${formatDate(local.slice(0, 10))}, ${local.slice(11, 16)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(Math.round((bytes / 1048576) * 10) / 10).toFixed(1)} MB`;
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}
