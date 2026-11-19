// Every number format and count phrase the brief publishes.
import { frozenCounts } from "../../shared/findingsSetRules";
import { counted, zonedMinute } from "../../shared/text";
import type { FlightAnswer } from "./api";



/** Chainage outside the readout and value text: one decimal, no grouping, with its unit. */
export function chainageText(m: number): string {
  return `${m.toFixed(1)} m`;
}

/** Heights, clearances, offsets and radii: two decimals with the unit. */
export function metres2(m: number): string {
  return `${m.toFixed(2)} m`;
}

/** The readout's Chainage line: thousands commas and one decimal. */
export function readoutChainage(m: number): string {
  return `Chainage ${m.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}


/** The slider's value text: whole metres with commas, and the near count with its exception for zero. */
export function sliderValueText(m: number, fromTower: number, toTower: number, near: number): string {
  const nearby = near === 0 ? "no findings nearby" : `${counted(near, "finding")} nearby`;
  return `Chainage ${Math.round(m).toLocaleString("en-US")} metres, span ${fromTower} to ${toTower}, ${nearby}`;
}

export function droneLine(answer: Extract<FlightAnswer, { covered: true }>): string {
  const { lat_deg: lat, lon_deg: lon, height_m: h } = answer.position;
  return `Drone ${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(6)}° ${lon >= 0 ? "E" : "W"}, ${h.toFixed(1)} m`;
}

export function flightTimeLine(time: string): string {
  return `Flight time ${time.slice(0, 10)} ${time.slice(11, 19)} UTC`;
}

export function cameraLine(aboveGroundM: number, headingDeg: number, pitchDeg: number): string {
  const heading = ((headingDeg % 360) + 360) % 360;
  return `Camera ${aboveGroundM.toFixed(1)} m above ground, heading ${heading.toFixed(1)}°, pitch ${pitchDeg.toFixed(1)}°`;
}

export function linkExpiryLine(iso: string, timeZone: string): string {
  return `Link expires ${zonedMinute(new Date(iso), timeZone)} (${timeZone})`;
}

export function inspectionDueLine(due: string, timeZone: string): string {
  return `Inspection due ${due} (${timeZone})`;
}

const SET_STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  accepted: "Accepted",
  disputed: "Disputed",
  closed: "Closed",
};

export function setStateLabel(state: string | null | undefined): string {
  return state == null ? "No findings set" : (SET_STATE_LABELS[state] ?? state);
}

export function summaryLine(findings: Array<{ status: string }>): string {
  const counts = frozenCounts(findings.map((f) => f.status));
  return `${counted(counts.finding_count, "finding")} · ${counted(counts.violation_count, "violation")}`;
}
