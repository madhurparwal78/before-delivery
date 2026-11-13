// The waypoint table: every value from the painted plan, numerals with their units.
import { clearanceCell, signedMetres, metres } from "../../shared/numerals";
import { zoneAbbreviation } from "../../shared/portTime";
import type { Plan } from "../../shared/types";

/** `rows`: the route's waypoint count, so the table holds its painted height while a plan is read. */
export function WaypointTable({ plan, rows = 1 }: { plan: Plan | null; rows?: number }) {
  return (
    <table className="waypoints" aria-label="Waypoints">
      <thead>
        <tr>
          <th scope="col">Waypoint</th>
          <th scope="col">Arrives</th>
          <th scope="col">Leg speed</th>
          <th scope="col">Squat</th>
          <th scope="col">Water</th>
          <th scope="col">Clearance</th>
          <th scope="col">Required</th>
          <th scope="col">Margin</th>
        </tr>
      </thead>
      <tbody>
        {plan ? (
          plan.waypoints.map((w) => (
            <tr key={w.id} className={w.pinch ? "pinch-row" : undefined}>
              <th scope="row">
                {w.name}
                {w.pinch ? <span className="tag">Pinch</span> : null}
              </th>
              <td className="num">
                {w.arrival_at.slice(11, 16)} {zoneAbbreviation(w.arrival_utc_offset)}
              </td>
              <td className="num">{w.leg_speed_kn} kn</td>
              <td className="num">{metres(w.squat_mm)} m</td>
              <td className="num">{clearanceCell(w.sounded_depth_mm + w.tide_mm)}</td>
              <td className="num">{clearanceCell(w.clearance_mm)}</td>
              <td className="num">{clearanceCell(plan.required_mm)}</td>
              <td className={w.margin_mm < 0 ? "num short" : "num"}>
                {signedMetres(w.margin_mm)} m{w.margin_mm < 0 ? " short" : ""}
              </td>
            </tr>
          ))
        ) : (
          Array.from({ length: Math.max(rows, 1) }, (_, i) => (
            <tr key={i}>
              <td colSpan={8} className="muted">
                {i === 0 ? "Reading the plan" : "\u00a0"}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
