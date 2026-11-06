// Requests: everything filed from the rehearsal room, with the outcome the intake holds.

import { useEffect, useState } from "react";
import type { IntakeRequest } from "../../../shared/catalog";
import { call } from "../api";
import { copy, stamp } from "../copy";
import { openDialog, useApp } from "../store";
import { Tape } from "./bits";

const OUTCOME: Record<IntakeRequest["status"], string> = { pending: "Pending", accepted: "Accepted", declined: "Declined", merged: "Merged" };

export const RequestsScreen = () => {
  const app = useApp();
  const [requests, setRequests] = useState<IntakeRequest[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    call<{ requests: IntakeRequest[] }>("GET", "/api/requests")
      .then((reply) => {
        if (!live) return;
        setUnavailable(!reply.ok);
        setRequests(reply.ok ? reply.body.requests : []);
      })
      .catch(() => {
        if (!live) return;
        setUnavailable(true);
        setRequests([]);
      });
    return () => {
      live = false;
    };
  }, [app.requestsSerial, app.status.intake]);
  const zone = app.production?.time_zone;

  return (
    <section className="requests" aria-labelledby="requests-heading">
      <div className="screen-head">
        <h2 id="requests-heading" className="screen-title">
          Requests
        </h2>
        <button type="button" className="button primary" onClick={(e) => openDialog({ kind: "file-request", opener: e.currentTarget })}>
          File a request
        </button>
      </div>
      <table className="requests-table" role="table" aria-label="Requests">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Request</th>
            <th role="columnheader" scope="col">Requester</th>
            <th role="columnheader" scope="col">Filed</th>
            <th role="columnheader" scope="col">Outcome</th>
            <th role="columnheader" scope="col">Task</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {unavailable ? (
            <tr role="row" className="table-note">
              <td role="cell" colSpan={5}>
                {copy.outcomesUnavailable}
              </td>
            </tr>
          ) : requests && !requests.length ? (
            <tr role="row" className="table-note">
              <td role="cell" colSpan={5}>
                {copy.noRequests}
              </td>
            </tr>
          ) : (
            (requests ?? []).map((r) => (
              <tr role="row" key={r.id}>
                <td role="cell">
                  <span className="request-title">
                    <span>{r.title}</span>
                    {r.department ? <Tape dept={r.department} /> : null}
                  </span>
                </td>
                <td role="cell" data-label="Requester">
                  {r.requester}
                </td>
                <td role="cell" data-label="Filed" className="num filed">
                  {zone ? stamp(r.created, zone) : ""}
                </td>
                <td role="cell" data-label="Outcome">
                  <span className={`chip outcome-${r.status}`}>{OUTCOME[r.status]}</span>
                </td>
                <td role="cell" data-label="Task" className={r.task ? "num" : "muted"}>
                  {r.task ?? copy.awaitingTriage}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
};
