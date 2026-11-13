// Published wording the pages show: status words, the pay-by line, intake rows and the scale readout format.
import type { Dimensions, IntakeFile, Invoice } from "./api";
import { longDate, utcTime } from "../shared/format";

export const STATUS_WORDS: Record<Invoice["status"], string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  payment_failed: "Payment failed",
  overdue: "Overdue",
  void: "Void",
};

export const payBy = (overdueAt: string): string => `Pay by ${longDate(overdueAt)}, ${utcTime(overdueAt)} UTC to avoid an overdue notice.`;

export function intakeStatus(file: IntakeFile): string {
  if (file.measurement === "failed") return "Rejected";
  return file.status === "superseded" ? "Superseded" : "Received";
}

export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

/** Rounds half up to `places` decimals (display only). */
function halfUp(value: number, places: number): string {
  const factor = 10 ** places;
  return (Math.floor(value * factor + 0.5 + 1e-9) / factor).toFixed(places);
}

export const mmReadout = (mm: Dimensions): string => `${halfUp(mm.x, 1)} × ${halfUp(mm.y, 1)} × ${halfUp(mm.z, 1)} mm`;
export const inchReadout = (mm: Dimensions): string => `${halfUp(mm.x / 25.4, 2)} × ${halfUp(mm.y / 25.4, 2)} × ${halfUp(mm.z / 25.4, 2)} in`;
export const metreReadout = (m: Dimensions): string => `${halfUp(m.x, 3)} × ${halfUp(m.y, 3)} × ${halfUp(m.z, 3)} m`;
