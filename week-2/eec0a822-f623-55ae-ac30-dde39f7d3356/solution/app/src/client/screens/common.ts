// Labels and small conversions the screens share.
import { metresToCentimetres } from "../../shared/money";

export const BASE_LABEL = { split: "Split", lavrio: "Lavrio" } as const;
export const SEASON_LABEL = { low: "Low season", shoulder: "Shoulder season", high: "High season" } as const;
export const WEEK_STATUS = { free: "Free", held: "Held", booked: "Booked" } as const;

/** Metres from the API as whole centimetres, exactly. */
export function centimetres(metres: number): number {
  return metresToCentimetres(String(metres)) ?? 0;
}

export interface HoldView {
  id: string;
  yachtSlug: string;
  weekStart: string;
  weekEnd: string;
  clientName: string;
  placedBy: { kind: "member" | "broker"; name: string };
  status: "waiting" | "live" | "lapsed" | "released" | "charter";
  position: number | null;
  placedAt: string;
  liveSince: string | null;
  lapsesAt: string | null;
  charterId: string | null;
}

/** The published hold status label, exactly as the server reports the status. */
export function holdStatusLabel(hold: { status: HoldView["status"]; position: number | null }): string {
  switch (hold.status) {
    case "live":
      return "Live";
    case "waiting":
      return `Waiting, ${hold.position} in line`;
    case "lapsed":
      return "Lapsed";
    case "released":
      return "Released";
    default:
      return "Charter";
  }
}
