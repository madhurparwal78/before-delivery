// The staff action record (brief: Business rules › Staff action record), newest first, for the
// manager in the box office and the lead curator in the studio.

import { useApi } from "../hooks.js";
import { Skeleton } from "./ui.js";
import { formatLisbonDateTime } from "../../shared/lisbon.js";

interface StaffAction {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
}

function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

export function StaffActions({ version }: { version: number }) {
  const record = useApi<{ actions: StaffAction[] }>(`/api/manager/audit?v=${version}`);
  return (
    <section aria-label="Staff action record" className="staff-section museum-card">
      <p className="catalogue">HRR-RECORD</p>
      <h2 className="card-title">Staff action record</h2>
      {!record.data ? (
        <Skeleton lines={4} />
      ) : (
        <div className="table-scroll table-tall">
          <table aria-label="Staff actions" className="data-table stack-on-phone">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {record.data.actions.map((a) => (
                <tr key={a.id}>
                  <td data-label="When">{formatLisbonDateTime(Date.parse(a.at))}</td>
                  <td data-label="Who">{a.actor_email}</td>
                  <td data-label="Action" className="figure">
                    {a.action}
                  </td>
                  <td data-label="Target" className="figure">
                    {a.target_type} {a.target_id}
                  </td>
                  <td data-label="Detail" className="detail-cell">
                    {detailText(a.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
