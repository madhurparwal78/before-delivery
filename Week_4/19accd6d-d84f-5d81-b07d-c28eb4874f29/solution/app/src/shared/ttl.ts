const UNITS: Record<string, { seconds: number; name: string }> = {
  s: { seconds: 1, name: "second" },
  m: { seconds: 60, name: "minute" },
  h: { seconds: 3600, name: "hour" },
  d: { seconds: 86400, name: "day" },
};

/** The lifetime in seconds of a share snapshot choice such as `1h`, or null when the choice is not a number and a unit. */
export function ttlSeconds(choice: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(choice);
  return match ? Number(match[1]) * (UNITS[match[2] as string] as { seconds: number }).seconds : null;
}

/** The published label of a choice: "1 hour", "7 days". */
export function ttlLabel(choice: string): string {
  const match = /^(\d+)([smhd])$/.exec(choice) as RegExpExecArray;
  const count = Number(match[1]);
  const unit = (UNITS[match[2] as string] as { name: string }).name;
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
