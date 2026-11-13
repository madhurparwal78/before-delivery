const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** `2026-11-02` written as `2 November 2026`, never through the browser's locale or zone. */
export function writtenDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

export interface Identity {
  title: string;
  maker: string | null;
  year: number | null;
}

/** `<title>, <maker> <year>` with the missing parts dropped. */
export function identityLine({ title, maker, year }: Identity): string {
  if (!maker) return title;
  return year ? `${title}, ${maker} ${year}` : `${title}, ${maker}`;
}

export function stopAnnouncement(position: number, playableCount: number, identity: Identity): string {
  return `Reference ${position} of ${playableCount}: ${identityLine(identity)}`;
}

/** `<maker>, <year>` as printed on a contact sheet. */
export function makerYearLine({ maker, year }: Pick<Identity, "maker" | "year">): string {
  if (!maker) return "";
  return year ? `${maker}, ${year}` : maker;
}

export function countdownText(secondsLeft: number): string {
  if (secondsLeft >= 86_400) return `${Math.floor(secondsLeft / 86_400)}d ${Math.floor((secondsLeft % 86_400) / 3_600)}h`;
  if (secondsLeft >= 3_600) return `${Math.floor(secondsLeft / 3_600)}h ${Math.floor((secondsLeft % 3_600) / 60)}m`;
  return `${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`;
}
