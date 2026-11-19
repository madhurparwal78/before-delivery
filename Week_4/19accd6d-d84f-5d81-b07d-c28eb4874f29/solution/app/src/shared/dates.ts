const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
  "December",
];

/** An ISO time written the published way: "6 November 2026 at 09:00 UTC". */
export function briefDate(iso: string): string {
  const moment = new Date(iso);
  const hours = String(moment.getUTCHours()).padStart(2, "0");
  const minutes = String(moment.getUTCMinutes()).padStart(2, "0");
  return `${moment.getUTCDate()} ${MONTHS[moment.getUTCMonth()]} ${moment.getUTCFullYear()} at ${hours}:${minutes} UTC`;
}
