import type { ReactNode } from "react";
import { angle, chainageGrouped, degrees6, spanLabel, utcSecond } from "../../shared/format.js";
import { DRONE_LOCATING, NO_FLIGHT_COVERAGE, streamingTiles } from "../../shared/copy.js";
import type { CameraPose } from "../lib/view.js";
import type { FlightAnswer } from "../lib/types.js";

export interface ReadoutProps {
  chainageM: number;
  span: { from: number; to: number };
  flight: { pending: boolean; answer: FlightAnswer | null };
  camera: CameraPose | null;
  cameraHeightAboveGroundM: number | null;
  streamingCount: number;
}

function droneLine(flight: ReadoutProps["flight"]): string {
  if (flight.pending || !flight.answer) return DRONE_LOCATING;
  if (!flight.answer.covered || !flight.answer.position) return `Drone ${NO_FLIGHT_COVERAGE}`;
  const { lon_deg: lon, lat_deg: lat, height_m: height } = flight.answer.position;
  return `Drone ${degrees6(Math.abs(lat))}\u00b0 ${lat >= 0 ? "N" : "S"}, ${degrees6(
    Math.abs(lon),
  )}\u00b0 ${lon >= 0 ? "E" : "W"}, ${height.toFixed(1)} m`;
}

export function Readout(props: ReadoutProps): ReactNode {
  const { flight } = props;
  const answer = flight.pending ? null : flight.answer;
  const flightTime = answer?.covered === true ? answer.time : null;

  return (
    <section className="readout" aria-label="Position readout">
      <p className="mono">Chainage {chainageGrouped(props.chainageM)} m</p>
      <p className="mono">{spanLabel(props.span.from, props.span.to)}</p>
      <p className="mono">{droneLine(flight)}</p>
      {flightTime === null ? null : (
        <p className="mono">Flight time {utcSecond(flightTime)} UTC</p>
      )}
      {props.camera ? (
        <p className="mono">
          Camera {angle(props.cameraHeightAboveGroundM ?? props.camera.heightM)} m above ground,
          heading {angle(props.camera.headingDeg)}
          {"\u00b0"}, pitch {angle(props.camera.pitchDeg)}
          {"\u00b0"}
        </p>
      ) : null}
      {props.streamingCount > 0 ? (
        <p className="mono readout__streaming">{streamingTiles(props.streamingCount)}</p>
      ) : null}
    </section>
  );
}
