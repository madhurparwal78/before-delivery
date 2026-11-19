/** Generates the seeded flight track. */

import { centrelineAt, type CorridorGeometry } from "../../shared/corridor.js";
import { ASH_CREEK_TRACK } from "../seed-data.js";

export function buildAshCreekCzml(corridor: CorridorGeometry): Uint8Array {
  const epochMs = Date.parse(ASH_CREEK_TRACK.epoch);
  const samples: { seconds: number; chainageM: number }[] = [];

  for (const interval of ASH_CREEK_TRACK.intervals) {
    const startSeconds = (Date.parse(interval.start) - epochMs) / 1000;
    const endSeconds = (Date.parse(interval.end) - epochMs) / 1000;
    const duration = endSeconds - startSeconds;
    for (
      let seconds = startSeconds;
      seconds <= endSeconds + 1e-9;
      seconds += ASH_CREEK_TRACK.stepSeconds
    ) {
      const fraction = duration === 0 ? 0 : (seconds - startSeconds) / duration;
      samples.push({
        seconds,
        chainageM: interval.fromM + (interval.toM - interval.fromM) * fraction,
      });
    }
  }
  samples.push(...ASH_CREEK_TRACK.strays);
  samples.sort((a, b) => a.seconds - b.seconds);

  const cartographicDegrees: number[] = [];
  for (const sample of samples) {
    const point = centrelineAt(corridor, sample.chainageM);
    cartographicDegrees.push(
      sample.seconds,
      round(point.lonDeg, 9),
      round(point.latDeg, 9),
      ASH_CREEK_TRACK.heightM,
    );
  }

  const document = [
    {
      id: "document",
      name: "Ash Creek corridor survey flight 2026-06-14",
      version: "1.0",
      clock: {
        interval: `${ASH_CREEK_TRACK.intervals[0].start}/${
          ASH_CREEK_TRACK.intervals[ASH_CREEK_TRACK.intervals.length - 1].end
        }`,
        currentTime: ASH_CREEK_TRACK.intervals[0].start,
        multiplier: 1,
      },
    },
    {
      id: "survey-drone",
      name: "Survey drone",
      availability: ASH_CREEK_TRACK.intervals.map(
        (interval) => `${interval.start}/${interval.end}`,
      ),
      position: {
        epoch: ASH_CREEK_TRACK.epoch,
        cartographicDegrees,
      },
      path: {
        width: 2,
        material: { solidColor: { color: { rgba: [26, 34, 48, 220] } } },
      },
    },
  ];

  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
