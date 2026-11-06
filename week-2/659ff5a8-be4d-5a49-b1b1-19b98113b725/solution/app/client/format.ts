import type { CorrectionValues, RunView } from "../shared/api.js";

/** `<raw time> +<cones>` with the cone count always shown, or `DNF`. */
export function formatValues(values: CorrectionValues): string {
  return values.outcome === "dnf" ? "DNF" : `${values.rawTime ?? ""} +${values.cones ?? 0}`;
}

export function formatRunTime(run: RunView): string {
  if (run.outcome === "dnf") return "DNF";
  if (run.status === "rerun_granted") return "RRN";
  return run.rawTime ?? "";
}

export const coneLabel = (count: number): string => `${count} ${count === 1 ? "cone" : "cones"}`;

export const stationsOpen = (count: number): string => `${count} ${count === 1 ? "station" : "stations"} open`;
