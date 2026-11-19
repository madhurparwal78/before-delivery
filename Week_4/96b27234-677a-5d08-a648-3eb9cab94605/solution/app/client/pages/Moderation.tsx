import { useCallback, useEffect, useState } from "react";
import { call } from "../lib/api";
import { account, useStore } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Chip, Empty, Loading, Status } from "../ui/Bits";
import { NotFound } from "./NotFound";

interface Report {
  id: string;
  personName: string;
  roomName: string;
  category: string;
  details: string;
  state: "open" | "reviewing" | "upheld" | "dismissed";
  action: string | null;
}

export function Moderation() {
  const state = useStore(account);
  const moderator = state.state === "in" && state.me.siteRole === "moderator";
  const [reports, setReports] = useState<Report[] | null>(null);
  const action = useAction("Saving...");
  const load = useCallback(async (): Promise<void> => {
    const reply = await call<{ reports: Report[] }>("GET", "/api/moderation/reports");
    if (reply.ok) setReports(reply.data.reports);
  }, []);
  useEffect(() => {
    if (moderator) void load();
  }, [moderator, load]);
  if (!moderator) return <NotFound />;
  const move = async (report: Report, body: { state: string; action?: string }): Promise<void> => {
    const reply = await action.run("POST", `/api/moderation/reports/${report.id}/move`, body, () => `Report moved to ${body.state}.`);
    if (reply.ok) await load();
  };
  return (
    <>
      <h1 tabIndex={-1}>Moderation</h1>
      <section className="panel">
        <h2>Reports</h2>
        <Status name="Moderation result" result={action.result} />
        {reports === null ? (
          <Loading />
        ) : reports.length === 0 ? (
          <Empty>No reports to review.</Empty>
        ) : (
          <table role="table" aria-label="Reports" className="reports stack-table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Person</th>
                <th role="columnheader" scope="col">Room</th>
                <th role="columnheader" scope="col">Category</th>
                <th role="columnheader" scope="col">Details</th>
                <th role="columnheader" scope="col">State</th>
                <th role="columnheader" scope="col">Actions</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {reports.map((report) => (
                <tr role="row" key={report.id} data-report-id={report.id} data-report-state={report.state}>
                  <td role="cell" data-label="Person">{report.personName}</td>
                  <td role="cell" data-label="Room">{report.roomName}</td>
                  <td role="cell" data-label="Category">{report.category}</td>
                  <td role="cell" data-label="Details" className="details">
                    {report.details}
                  </td>
                  <td role="cell" data-label="State">
                    <Chip tone={report.state === "open" ? "accent" : report.state === "reviewing" ? "calm" : "plain"}>
                      {report.state}
                      {report.action ? `: ${report.action}` : ""}
                    </Chip>
                  </td>
                  <td role="cell" data-label="Actions">
                    <div className="row tight">
                      {report.state === "open" ? (
                        <button type="button" className="button primary" onClick={() => void move(report, { state: "reviewing" })}>
                          Start review
                        </button>
                      ) : null}
                      {report.state === "reviewing" ? (
                        <>
                          <button type="button" className="button" onClick={() => void move(report, { state: "upheld", action: "warn" })}>
                            Warn
                          </button>
                          <button type="button" className="button danger" onClick={() => void move(report, { state: "upheld", action: "suspend" })}>
                            Suspend
                          </button>
                          <button type="button" className="button" onClick={() => void move(report, { state: "dismissed" })}>
                            Dismiss
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
