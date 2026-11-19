/** Samples the flight endpoint across each covered range to draw the flown track. */

import { api } from "./api.js";
import { chainage as fmtChainage } from "../../shared/format.js";
import type { CoverageRange, FlightAnswer } from "./types.js";

const SAMPLES_PER_RANGE = 9;

export async function loadTrackPolyline(
  flightPath: string,
  coverage: CoverageRange[],
): Promise<{ lon: number; lat: number; height: number }[]> {
  const positions: { lon: number; lat: number; height: number }[] = [];
  for (const range of coverage) {
    for (let step = 0; step <= SAMPLES_PER_RANGE; step += 1) {
      const chainageM = range.from_m + ((range.to_m - range.from_m) * step) / SAMPLES_PER_RANGE;
      try {
        const answer = await api<FlightAnswer>(
          "GET",
          `${flightPath}?chainage_m=${fmtChainage(chainageM)}`,
        );
        if (answer.covered && answer.position) {
          positions.push({
            lon: answer.position.lon_deg,
            lat: answer.position.lat_deg,
            height: answer.position.height_m,
          });
        }
      } catch {
        return positions;
      }
    }
  }
  return positions;
}
