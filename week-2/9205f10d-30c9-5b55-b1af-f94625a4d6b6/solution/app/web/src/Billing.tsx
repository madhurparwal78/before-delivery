import { useCallback, useEffect, useState } from "react";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api, idempotencyKey } from "./api";
import { confirmedCount, dateLine } from "./format";
import { REFRESH_MS, useInterval } from "./motion";
import type { ApiRequest, Invoice } from "./types";

/** Ready to close: completed requests, each closed into one exact charge. */
export function Billing() {
  const [ready, setReady] = useState<ApiRequest[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "alert">("ok");

  const load = useCallback(async () => {
    const result = await api<{ requests: ApiRequest[] }>("GET", "/api/requests?status=completed");
    if (result.ok) setReady(result.data.requests);
  }, []);
  useEffect(() => void load(), [load]);
  useInterval(() => void load(), REFRESH_MS);

  const close = async (request: ApiRequest) => {
    setClosing(request.id);
    setTone("ok");
    setMessage(`Closing ${request.reference}…`);
    const result = await api<{ request: ApiRequest; invoice: Invoice }>(
      "POST",
      `/api/requests/${request.id}/close`,
      {},
      { "Idempotency-Key": idempotencyKey() },
    );
    setClosing(null);
    if (result.ok) {
      const { invoice } = result.data;
      setReady((rows) => (rows ?? []).filter((r) => r.id !== request.id));
      if (invoice.billing_status === "posted") setMessage(`${request.reference} invoiced at $${invoice.amount}.`);
      else {
        setTone("alert");
        setMessage(
          `${request.reference} closed at $${invoice.amount}. Invoice pending: it posts to billing automatically once the billing system responds.`,
        );
      }
      return;
    }
    setTone("alert");
    setMessage(result.error?.message ?? OFFLINE_COPY);
    void load();
  };

  return (
    <div className="page">
      <h1>Billing</h1>
      <p className="lede">Completed jobs waiting to be charged. Closing one computes its charge once and posts it to the client's billing account.</p>
      <p className={`live${tone === "alert" ? " live--alert" : ""}`} role="status" aria-label="Billing status">
        {message}
      </p>
      <h2 className="table-title">Ready to close</h2>
      {ready === null ? (
        <Placeholder />
      ) : (
        <table className="data-table stack" aria-label="Ready to close">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Organisation</th>
              <th scope="col">Date</th>
              <th scope="col" className="numeric">
                Seats
              </th>
              <th scope="col" className="numeric">
                Actual minutes
              </th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {ready.map((r) => (
              <tr key={r.id}>
                <td data-label="Reference" className="num">
                  {r.reference}
                </td>
                <td data-label="Organisation">{r.organisation?.name}</td>
                <td data-label="Date">{dateLine(r.starts_at)}</td>
                <td data-label="Seats" className="num numeric">
                  {confirmedCount(r)}
                </td>
                <td data-label="Actual minutes" className="num numeric">
                  {r.actual_minutes}
                </td>
                <td data-label="Action">
                  <button type="button" className="button button--primary" aria-label={`Close ${r.reference}`} disabled={closing === r.id} onClick={() => void close(r)}>
                    Close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {ready?.length === 0 && <p className="empty">Nothing is ready to close.</p>}
    </div>
  );
}
