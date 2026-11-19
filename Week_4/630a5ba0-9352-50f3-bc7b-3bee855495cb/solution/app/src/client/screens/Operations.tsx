import { useEffect, useState } from "react";
import type { OpsWorkspace, WorkspaceState } from "../../shared/types.js";
import { dayLabel, wallOf } from "../../shared/time.js";
import { api, SERVER_ERROR } from "../api.js";
import { announce } from "../announce.js";

const STATES: Record<WorkspaceState, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  read_only: "Read-only",
  cancelled: "Cancelled",
};

const when = (iso: string) => {
  const wall = wallOf(Date.parse(iso), "UTC");
  return `${dayLabel(wall.date)} ${wall.time} UTC`;
};

export function Operations() {
  const [rows, setRows] = useState<OpsWorkspace[] | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ workspaces: OpsWorkspace[] }>("GET", "/api/ops/workspaces")
        .then((data) => setRows(data.workspaces))
        .catch(() => announce(SERVER_ERROR));
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="operations">
      <h1 className="page-title">Operations</h1>
      <p className="muted">Billing state, seats, queued mail and billing work, and import activity for every workspace.</p>
      <table className="ledger" aria-label="Workspaces">
        <thead>
          <tr>
            <th scope="col">Workspace</th>
            <th scope="col">State</th>
            <th scope="col">Trial ends</th>
            <th scope="col" className="num">
              Seats
            </th>
            <th scope="col" className="num">
              Queued
            </th>
            <th scope="col">Last import</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((row) => (
            <tr key={row.id}>
              <td data-label="Workspace" className="wrap">
                {row.name}
              </td>
              <td data-label="State">
                <span className={`state state-${row.state}`}>{STATES[row.state]}</span>
              </td>
              <td data-label="Trial ends">{when(row.trialEndsAt)}</td>
              <td data-label="Seats" className="num mono">
                {row.activeSeats} / {row.billedSeats ?? "—"}
              </td>
              <td data-label="Queued" className="num mono">
                {row.outbox.pending}
              </td>
              <td data-label="Last import">{row.imports.lastAt ? `${when(row.imports.lastAt)} · ${row.imports.batches}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows === null && <p className="muted">Reading workspaces…</p>}
    </div>
  );
}
