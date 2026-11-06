// Display formats shared by every screen and every email (brief: Feedback states, Display formats).

export function formatCount(value: number | bigint): string {
  const digits = BigInt(value).toString();
  const negative = digits.startsWith("-");
  const body = negative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

export function formatTime(value: string | Date): string {
  const iso = (typeof value === "string" ? new Date(value) : value).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function formatRegionCount(n: number): string {
  return n === 1 ? "1 region" : `${formatCount(n)} regions`;
}

export function shortVersion(versionId: string): string {
  return versionId.slice(0, 8);
}
