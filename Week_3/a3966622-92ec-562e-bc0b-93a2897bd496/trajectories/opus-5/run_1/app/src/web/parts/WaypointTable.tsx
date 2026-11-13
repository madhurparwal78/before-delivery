import { arrivalText, clearanceCell, marginFromMm, metresFromMm, waterDepthMm } from '../format.ts';
import type { Plan } from '../types.ts';

export function WaypointTable({ plan }: { plan: Plan | null }): JSX.Element {
  return (
    <div className="scroll-x">
      <table aria-label="Waypoints">
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
        {(plan?.waypoints ?? []).map((waypoint) => (
          <tr key={waypoint.id}>
            <th scope="row">{waypoint.name}</th>
            <td>{arrivalText(waypoint)}</td>
            <td>{`${waypoint.leg_speed_kn} kn`}</td>
            <td>{`${metresFromMm(waypoint.squat_mm)} m`}</td>
            <td>{clearanceCell(waterDepthMm(waypoint))}</td>
            <td>{clearanceCell(waypoint.clearance_mm)}</td>
            <td>{clearanceCell(plan?.required_mm ?? 0)}</td>
            <td className={waypoint.margin_mm < 0 ? 'negative' : undefined}>
              {`${marginFromMm(waypoint.margin_mm)} m`}
            </td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
}
