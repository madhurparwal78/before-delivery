// The position readout: chainage, span, drone, flight time and camera, all in tabular mono, plus
// the streaming count while tiles stream.
import { useEffect, useState } from "react";
import { project } from "../../../shared/geodesy";
import type { CameraRig, Pose } from "../camera";
import type { CorridorShape } from "../corridorMath";
import { spanOf } from "../corridorMath";
import { cameraLine, droneLine, flightTimeLine, readoutChainage } from "../format";
import { counted, spanLabel } from "../../../shared/text";
import type { Drone } from "../view";

function cameraText(rig: CameraRig, shape: CorridorShape, pose: Pose): string {
  const chainage = project(shape.line, { lonDeg: pose.lonDeg, latDeg: pose.latDeg }).chainageM;
  return cameraLine(pose.heightM - rig.groundAt(pose.lonDeg, pose.latDeg, chainage), pose.headingDeg, pose.pitchDeg);
}

/** The camera line, following every pose the rig reports. */
export function useCameraLine(rig: CameraRig, shape: CorridorShape): string {
  const [line, setLine] = useState(() => cameraText(rig, shape, rig.pose));
  useEffect(() => {
    setLine(cameraText(rig, shape, rig.pose));
    return rig.subscribe((pose) => setLine(cameraText(rig, shape, pose)));
  }, [rig, shape]);
  return line;
}

interface ReadoutProps {
  shape: CorridorShape;
  chainageM: number;
  drone: Drone;
  camera: string;
  streaming: number;
  className: string;
}

export function Readout({ shape, chainageM, drone, camera, streaming, className }: ReadoutProps) {
  const span = spanOf(shape, chainageM);
  return (
    <div role="region" aria-label="Position readout" className={`readout ${className}`}>
      <p>{readoutChainage(chainageM)}</p>
      <p>{spanLabel(span.from, span.to)}</p>
      <p>{drone.kind === "placed" ? droneLine(drone.answer) : drone.kind === "uncovered" ? "Drone No flight coverage" : "Drone locating..."}</p>
      {drone.kind === "placed" && <p>{flightTimeLine(drone.answer.time)}</p>}
      <p>
        {camera.split(", ").map((clause, i) => (
          <span className="clause" key={clause}>
            {i > 0 ? ", " : ""}
            {clause}
          </span>
        ))}
      </p>
      {streaming > 0 && <p className="streaming">Streaming {counted(streaming, "tile")}</p>}
    </div>
  );
}
