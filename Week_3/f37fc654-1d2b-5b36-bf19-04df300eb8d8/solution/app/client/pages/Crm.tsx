// `/settings/crm` (the client's CRM endpoint) and `/c/<commission id>/webhooks` (the delivery log from Svix).
import { Fragment, useEffect, useState } from "react";
import { HttpError, call } from "../lib/api";
import { toast } from "../lib/notices";
import { CommissionLinks, Badge, Empty, Failed, Missing, Skeleton, failureText, useLoad, useScene } from "./common";

export function CrmSettings() {
  useScene("working");
  const [load, reload] = useLoad<{ url: string | null; signingSecret?: string }>("/api/me/crm-endpoint");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (load.status === "ready" && load.data.url) setUrl(load.data.url);
  }, [load]);

  const save = async (): Promise<void> => {
    setError("");
    try {
      await call("/api/me/crm-endpoint", { method: "PUT", json: { url } });
      toast("Endpoint saved.");
      await reload();
    } catch (e) {
      if (e instanceof HttpError && e.status === 422) setError(e.errors.url ?? "Enter a full http or https address.");
      else if (e instanceof HttpError && e.code === "webhooks_unavailable") toast("Couldn't save the endpoint — our webhook service isn't answering. Try again in a minute.");
      else toast(failureText(e));
    }
  };

  if (load.status === "failed") return <Failed message={load.message} />;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Settings</p>
        <h1>CRM settings</h1>
        <p className="muted">Slot, contract, milestone and maintenance events are sent to this address, signed, with one event id each.</p>
      </header>
      <form className="stack" noValidate onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}>
        <div className="field">
          <label htmlFor="crm-url">CRM endpoint URL</label>
          <input id="crm-url" className="input" type="url" placeholder="https://crm.example/hooks" value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby={error ? "crm-url-error" : undefined} />
          {error && <p className="field-error" id="crm-url-error">{error}</p>}
        </div>
        <div className="row-actions"><button type="submit" className="button primary">Save endpoint</button></div>
      </form>
      {load.status === "ready" && load.data.signingSecret && (
        <section className="section" aria-labelledby="secret-title">
          <h2 id="secret-title">Signing secret</h2>
          <p className="panel mono-hash">{load.data.signingSecret}</p>
          <p className="muted">Verify each delivery's signature with this secret.</p>
        </section>
      )}
    </main>
  );
}

interface Delivery { eventId: string; eventType: string; createdAt: string; finalState: string; attempts: { at: string; responseStatus: number; status: string }[] }

export function Deliveries({ id }: { id: string }) {
  useScene("working");
  const [load] = useLoad<{ deliveries: Delivery[] }>(`/api/commissions/${id}/webhook-deliveries`);
  const [open, setOpen] = useState<string | null>(null);
  if (load.status === "missing") return <Missing />;
  return (
    <main className="column wide">
      <header className="page-head">
        <p className="eyebrow">Your CRM</p>
        <h1>CRM deliveries</h1>
      </header>
      {load.status === "loading" && <Skeleton rows={3} />}
      {load.status === "failed" && <p className="chip-note" role="alert">{load.message}</p>}
      {load.status === "ready" && (load.data.deliveries.length ? (
        <div className="table-wrap" role="region" aria-label="CRM deliveries table" tabIndex={0}>
          <table aria-label="CRM deliveries">
            <thead><tr><th>Event</th><th>Type</th><th>Created</th><th className="num">Attempts</th><th>Final state</th></tr></thead>
            <tbody>
              {load.data.deliveries.map((d) => (
                <Fragment key={d.eventId}>
                  <tr onClick={() => setOpen(open === d.eventId ? null : d.eventId)} style={{ cursor: "pointer" }}>
                    <td>
                      <span className="mono-hash">{d.eventId.slice(0, 8)}…</span>{" "}
                      <button type="button" className="button" aria-expanded={open === d.eventId} onClick={(e) => {
                        e.stopPropagation();
                        setOpen(open === d.eventId ? null : d.eventId);
                      }}>{open === d.eventId ? "Hide attempts" : "Show attempts"}</button>
                    </td>
                    <td>{d.eventType}</td>
                    <td>{d.createdAt.replace("T", " ").slice(0, 19)}</td>
                    <td className="num">{d.attempts.length}</td>
                    <td><Badge state={d.finalState} on={d.finalState === "delivered"} /></td>
                  </tr>
                  {open === d.eventId && (
                    <tr>
                      <td colSpan={5}>
                        <p className="mono-hash">Event {d.eventId}</p>
                        {d.attempts.length ? (
                          <ul className="list">{d.attempts.map((a) => <li key={a.at}>{a.at.replace("T", " ").slice(0, 19)} · HTTP {a.responseStatus} · <Badge state={a.status} /></li>)}</ul>
                        ) : <p className="muted">No delivery attempts yet.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty question="No CRM deliveries yet. Add your endpoint?" drawing="signal" />)}
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>
    </main>
  );
}
