import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure } from "../api.js";
import { STAFF_COPY } from "../../../shared/copy.js";
import { formatDkk } from "../../../shared/money.js";
import { Button, TextField } from "../ui.js";
import { call, failureText, say } from "./desk.js";
import { formatInstant, humanise } from "./format.js";
import { rowStyle, StaffList, type Column } from "./List.js";
import type { Delivery, Statement } from "./types.js";

const DELIVERIES_EVERY_MS = 3000;

const columns: Column<Statement>[] = [
  { header: "Month", cell: (statement) => <strong>{statement.month}</strong> },
  { header: "Revision", cell: (statement) => statement.revision },
  { header: "Charity", cell: (statement) => formatDkk(statement.charityTotalOre) },
  { header: "Maker", cell: (statement) => formatDkk(statement.makerTotalOre) },
  { header: "VAT", cell: (statement) => formatDkk(statement.vatTotalOre) },
  { header: "Issued", cell: (statement) => formatInstant(statement.issuedAt) },
  {
    header: "Download",
    actions: true,
    cell: (statement) => (
      <a className="staff-download" href={statement.pdfUrl} download>Download statement {statement.month} revision {statement.revision}</a>
    ),
  },
];

export const StatementsPage = () => {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [month, setMonth] = useState("");
  const [monthProblem, setMonthProblem] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [endpointProblem, setEndpointProblem] = useState("");
  const [sendingTo, setSendingTo] = useState("");
  const unreachable = useRef(false);

  const loadStatements = useCallback(async (): Promise<void> => {
    try {
      setStatements((await call<{ statements: Statement[] }>("GET", "/api/staff/statements")).body.statements);
    } catch (error) {
      say(failureText(error), true);
    }
  }, []);

  /** The delivery view says an outage once, when it begins, so it never talks over an action's result. */
  const loadDeliveries = useCallback(async (): Promise<void> => {
    try {
      setDeliveries((await call<{ deliveries: Delivery[] }>("GET", "/api/staff/deliveries")).body.deliveries);
      unreachable.current = false;
    } catch (error) {
      setDeliveries([]);
      if (!unreachable.current) say(failureText(error), true);
      unreachable.current = true;
    }
  }, []);

  useEffect(() => {
    void loadStatements();
    void loadDeliveries();
    const timer = setInterval(() => void loadDeliveries(), DELIVERIES_EVERY_MS);
    return () => clearInterval(timer);
  }, [loadStatements, loadDeliveries]);

  const issue = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setMonthProblem("");
    try {
      await call("POST", "/api/staff/statements", { json: { month: month.trim() } });
      await loadStatements();
      say(STAFF_COPY.statementIssued);
    } catch (error) {
      const message = failureText(error);
      if (error instanceof ApiFailure && error.code === "month_invalid") setMonthProblem(message);
      say(message, true);
    }
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setEndpointProblem("");
    try {
      await call("PUT", "/api/staff/charity-endpoint", { json: { url: endpoint.trim() } });
      setSendingTo(endpoint.trim());
    } catch (error) {
      const message = failureText(error);
      setEndpointProblem(message);
      say(message, true);
    }
  };

  return (
    <>
      <form className="staff-form" aria-label="Issue a statement" onSubmit={(event) => void issue(event)}>
        <TextField label="Month" placeholder="2026-12" autoComplete="off" value={month} error={monthProblem} onChange={(event) => setMonth(event.target.value)} />
        <Button variant="primary" type="submit">Issue statement</Button>
      </form>
      <StaffList label="Statements" rows={statements} rowKey={(statement) => statement.id} columns={columns} empty="No statements have been issued yet." />
      <h2>Charity endpoint</h2>
      <form className="staff-form" aria-label="Charity endpoint" onSubmit={(event) => void save(event)}>
        <TextField
          label="Charity endpoint URL"
          inputMode="url"
          autoComplete="off"
          value={endpoint}
          error={endpointProblem}
          onChange={(event) => setEndpoint(event.target.value)}
        />
        <Button type="submit">Save endpoint</Button>
        {sendingTo ? <p className="muted">Sending to <code>{sendingTo}</code></p> : null}
      </form>
      <h2>Deliveries</h2>
      <div className="staff-scroll" tabIndex={0} role="group" aria-label="Deliveries, scrollable">
        <table className="staff-table staff-table--wide" aria-label="Deliveries">
          <thead>
            <tr>
              <th scope="col">Event</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Last status code</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery, index) => (
              <tr key={delivery.eventId} data-motion="row" style={rowStyle(index)}>
                <td><code>{delivery.eventId}</code></td>
                <td>{delivery.eventType}</td>
                <td>{humanise(delivery.status)}</td>
                <td>{delivery.attempts}</td>
                <td>{delivery.lastStatusCode ?? <span className="muted">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {deliveries.length === 0 ? <p className="muted staff-empty">No events have been sent to the charity yet.</p> : null}
      </div>
    </>
  );
};
