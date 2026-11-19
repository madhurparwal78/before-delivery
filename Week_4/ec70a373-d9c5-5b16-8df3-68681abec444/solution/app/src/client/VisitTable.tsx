// The commissary visit log table shared by Truck log, Trucks and the inspector view.
import type { ReactNode } from "react";
import { SERVICE_LABELS, type InspectorVisit } from "../shared/api.ts";
import { gapCellText, siteDateTime } from "../shared/format.ts";
import { EmptyState, Numerals } from "./ui.tsx";

export function VisitTable({ name, visits, timeZone }: { name: string; visits: InspectorVisit[]; timeZone: string }): ReactNode {
  return (
    <>
      <table role="table" aria-label={name} className="table table-grid">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Arrived</th>
            <th role="columnheader" scope="col">Departed</th>
            <th role="columnheader" scope="col">Services</th>
            <th role="columnheader" scope="col">Operator signature</th>
            <th role="columnheader" scope="col">Manager</th>
            <th role="columnheader" scope="col">Gap</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {visits.map((v) => (
            <tr role="row" key={`${v.arrived_at}-${v.departed_at ?? "open"}`} className={v.gap_flagged ? "row-flagged" : undefined}>
              <td role="cell" data-label="Arrived" className="mono"><Numerals text={siteDateTime(v.arrived_at, timeZone)} /></td>
              <td role="cell" data-label="Departed" className="mono"><Numerals text={v.departed_at ? siteDateTime(v.departed_at, timeZone) : "On site"} /></td>
              <td role="cell" data-label="Services">{v.services.map((s) => SERVICE_LABELS[s]).join(", ") || "—"}</td>
              <td role="cell" data-label="Operator signature">{v.operator_signature ?? "—"}</td>
              <td role="cell" data-label="Manager">{v.manager_name}</td>
              <td role="cell" data-label="Gap" className="mono">
                {v.gap_flagged ? <strong className="gap-flag">{gapCellText(v.gap_hours, true)}</strong> : gapCellText(v.gap_hours, false)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visits.length === 0 && <EmptyState drawing="clipboard">No visits recorded yet.</EmptyState>}
    </>
  );
}

export function OverdueNotice({ overdue, lastDepartedAt, timeZone }: { overdue: boolean; lastDepartedAt: string | null; timeZone: string }): ReactNode {
  if (!overdue || !lastDepartedAt) return null;
  return (
    <p className="banner">
      <Numerals text={`Overdue: last return ${siteDateTime(lastDepartedAt, timeZone)}`} />
    </p>
  );
}
