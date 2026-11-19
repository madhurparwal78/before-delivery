import type { Sample } from "../../shared/api.ts";
import { percent } from "../../shared/units.ts";

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Ids in tables show their first 8 and last 8 characters. */
export function truncateId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-8)}`;
}

/** A commission rate as a decimal fraction string ("0.05") shown as an exact percentage ("5.00%"). */
export function commissionText(commission: string): string {
  const [whole = "0", fraction = ""] = commission.split(".");
  return `${percent(Number(whole + fraction), 10 ** fraction.length, 2)}%`;
}

export function sampleText(height: number, sample: Sample): string {
  return sample.served
    ? `Sample ${sample.index}: share (${sample.row}, ${sample.col}) available. Confidence ${sample.confidence}%.`
    : `Sample ${sample.index}: share (${sample.row}, ${sample.col}) withheld. Block ${height} is unavailable.`;
}

export function sizeText(squareWidth: number): string {
  return `${squareWidth} × ${squareWidth}`;
}
