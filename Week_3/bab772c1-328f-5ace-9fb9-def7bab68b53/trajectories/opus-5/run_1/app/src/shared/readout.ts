/** The readout plate's lines, shared by the console, the share page and the dossier. */

import { formatDoy } from "./doy.js";
import { surfaceRange } from "./geometry.js";
import { EM_DASH } from "./copy.js";
import {
  formatDistance,
  formatLatitude,
  formatLongitude,
  formatSpeed,
  type DistanceUnit,
  type SpeedUnit,
} from "./units.js";

export type ReadoutSample = {
  met_label: string;
  utc_ms: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
};

export type ReadoutOptions = {
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  hasReference: boolean;
  landmarks: readonly { name: string; lat_deg: number; lon_deg: number }[];
};

export type ReadoutLine = { label: string; value: string };

export function readoutLines(
  sample: ReadoutSample,
  options: ReadoutOptions,
): ReadoutLine[] {
  const lines: ReadoutLine[] = [
    { label: "MET", value: sample.met_label },
    { label: "GMT", value: formatDoy(sample.utc_ms) },
    { label: "LAT", value: formatLatitude(sample.lat_deg) },
    { label: "LON", value: formatLongitude(sample.lon_deg) },
    { label: "ALT", value: formatDistance(sample.altitude_m, options.distanceUnit) },
    { label: "SPD", value: formatSpeed(sample.speed_m_s, options.speedUnit) },
  ];
  if (options.hasReference) {
    lines.push({
      label: "\u0394R",
      value:
        sample.residual_m === null
          ? EM_DASH
          : formatDistance(sample.residual_m, options.distanceUnit),
    });
  }
  for (const landmark of options.landmarks) {
    lines.push({
      label: `Range to ${landmark.name}`,
      value: formatDistance(
        surfaceRange(sample.lat_deg, sample.lon_deg, landmark.lat_deg, landmark.lon_deg),
        options.distanceUnit,
      ),
    });
  }
  return lines;
}
