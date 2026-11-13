/** The event list download: RFC 4180 records in the reader's current units. */

import { csvDocument, numericCell, textCell } from "../../shared/csv.js";
import {
  distanceNumber,
  distanceUnitLabel,
  speedNumber,
  type DistanceUnit,
  type SpeedUnit,
} from "../../shared/units.js";
import type { MissionEvent } from "../../shared/model.js";

export function eventsCsv(
  events: readonly MissionEvent[],
  distanceUnit: DistanceUnit,
  speedUnit: SpeedUnit,
): string {
  const header = [
    "met_label",
    "met_seconds",
    "title",
    `altitude_${distanceUnitLabel(distanceUnit)}`,
    `speed_${speedUnit}`,
    `residual_${distanceUnitLabel(distanceUnit)}`,
  ];
  const records = [
    header,
    ...events.map((event) => [
      textCell(event.met_label),
      numericCell(String(event.met)),
      textCell(event.title),
      numericCell(distanceNumber(event.sample.altitude_m, distanceUnit)),
      numericCell(speedNumber(event.sample.speed_m_s, speedUnit)),
      event.sample.residual_m === null
        ? ""
        : numericCell(distanceNumber(event.sample.residual_m, distanceUnit)),
    ]),
  ];
  return csvDocument(records);
}
