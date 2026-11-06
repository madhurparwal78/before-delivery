// Copy the brief prints verbatim, in one place.

export const COPY = {
  offlineBanner: "You're offline. Changes are saved on this phone and will sync when you reconnect.",
  photosOffline: "Photos need a connection.",
  emptyRoom: "No items in this room yet.",
  conflictHeading: "Needs a decision",
  planUnavailable: "Plan unavailable right now.",
  noJobs: "No jobs yet.",
  signedOut: "You've been signed out.",
  notSent: "Not sent yet",
  sent: "Sent",
  notFound: "We can't find that page.",
  backToJobs: "Back to your jobs",
  waiting: "Waiting to sync",
  uploading: "Photo uploading",
  saving: "Saving",
  problem: "There is a problem",
  nothingChanged: "Nothing changed",
  needsReview: "Pin needs review",
  needsConnection: "That needs a connection.",
} as const;

/** The number a row shows: the server's, or a placeholder until the server assigns one. */
export function numberText(n: number): string {
  return n > 0 ? String(n) : "new";
}

/** Corners as typed in the Corners format: percent pairs `x,y` separated by `;`. */
export function cornersText(outline: readonly { x: number; y: number }[]): string {
  const pct = (value: number) => String(Math.round(value * 1_000_000) / 10_000);
  return outline.map((corner) => `${pct(corner.x)},${pct(corner.y)}`).join("; ");
}

const PERCENT = /^\s*(\d{1,3}(?:\.\d{1,2})?)\s*$/;

/** A percent from 0 to 100 with up to two decimals, as a plan fraction; null when it doesn't read. */
export function percentToFraction(text: string): number | null {
  const match = PERCENT.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 100 ? null : Math.round(value * 100) / 10_000;
}

/** Reads `x,y; x,y; …` in percent into plan-fraction corners; null when any pair doesn't read. */
export function parseCorners(text: string): { x: number; y: number }[] | null {
  const pairs = text.split(";").filter((part) => part.trim() !== "");
  const corners = pairs.map((pair) => {
    const [x, y, ...rest] = pair.split(",");
    const fx = percentToFraction(x ?? "");
    const fy = percentToFraction(y ?? "");
    return rest.length === 0 && fx !== null && fy !== null ? { x: fx, y: fy } : null;
  });
  return corners.length > 0 && corners.every((corner) => corner !== null) ? (corners as { x: number; y: number }[]) : null;
}

export function readout(n: number, x: number, y: number): string {
  return `Placing pin for item ${numberText(n)}: ${percent(x)}% across, ${percent(y)}% down.`;
}

/** A plan fraction as a whole percentage, rounded half up. */
export function percent(fraction: number): number {
  return Math.floor(fraction * 100 + 0.5 + 1e-9);
}
