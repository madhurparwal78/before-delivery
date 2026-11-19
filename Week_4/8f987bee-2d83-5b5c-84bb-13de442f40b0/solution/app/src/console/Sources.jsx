import { useCallback, useEffect, useState } from "react";
import Field from "../components/Field.jsx";
import { api, outageCopy, PERMISSION } from "./api.js";
import { useConsole } from "./context.js";
import { localMinute } from "./format.js";

const EMPTY = { name: "", definition: "sample-commerce-api", apiKey: "", startDate: "" };
const FIELD_OF = { name: "name", definition_id: "definition", "config.api_key": "apiKey", "config.start_date": "startDate" };

export default function Sources() {
  const { editor, report } = useConsole();
  const [sources, setSources] = useState(null);
  const [definitions, setDefinitions] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const result = await api("/api/sources");
    if (result.ok) setSources(result.body.sources);
    else report(result);
  }, [report]);
  useEffect(() => {
    load();
    api("/api/connector-definitions?type=source").then((result) => {
      if (result.ok) setDefinitions(result.body.definitions.filter((d) => d.runnable));
    });
  }, [load]);

  const names = Object.fromEntries(definitions.map((d) => [d.id, d.name]));
  const custom = definitions.find((d) => d.id === form.definition)?.custom ?? false;
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const create = async (event) => {
    event.preventDefault();
    setPending(true);
    setStatus("Creating source…");
    setErrors({});
    const config = custom ? { api_key: form.apiKey } : { api_key: form.apiKey, start_date: form.startDate };
    const result = await api("/api/sources", { method: "POST", body: { name: form.name, definition_id: form.definition, config } });
    setPending(false);
    if (result.ok) {
      setStatus("Source created");
      setForm({ ...EMPTY, definition: form.definition });
      load();
    } else if (result.body?.error === "validation") {
      setStatus("");
      setErrors(Object.fromEntries(Object.entries(result.body.fields).map(([key, message]) => [FIELD_OF[key] ?? "name", message])));
    } else if (result.body?.error === "connector_not_installed") {
      setStatus("");
      setErrors({ definition: "This connector is not installed in this workspace." });
    } else {
      setStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
  };

  const check = async (source) => {
    setChecking(source.id);
    setStatus("Checking…");
    const result = await api(`/api/sources/${source.id}/check`, { method: "POST", body: {} });
    setChecking(null);
    if (result.ok) setStatus(result.body.status === "succeeded" ? "Check succeeded" : `Check failed: ${result.body.message}`);
    else {
      setStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Sources</h1></div>
      <div className={editor ? "split" : ""}>
        <section className="panel" aria-labelledby="sources-title">
          <h2 id="sources-title" className="panel-title">Sources</h2>
          <div className="table-frame" role="region" tabIndex={0} aria-label="Sources table">
            <table className="data sources-table">
              <thead><tr><th scope="col">Name</th><th scope="col">Connector</th><th scope="col">Start date</th><th scope="col">Created</th>{editor && <th scope="col"><span className="sr-only">Check</span></th>}</tr></thead>
              <tbody>
                {sources === null && <tr><td colSpan="5"><span className="skeleton" aria-hidden="true" /></td></tr>}
                {sources?.map((source) => (
                  <tr key={source.id}>
                    <th scope="row">{source.name}</th>
                    <td className="wrap">{names[source.definition_id] ?? source.definition_id}</td>
                    <td className="num">{source.config.start_date ?? "—"}</td>
                    <td className="num">{localMinute(source.created_at)}</td>
                    {editor && (
                      <td className="row-action"><button type="button" className="btn btn-outline btn-small" disabled={checking === source.id}
                        onClick={() => check(source)}>Check</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {editor && (
          <form className="panel form-grid" onSubmit={create} noValidate aria-labelledby="new-source-title">
            <h2 id="new-source-title" className="panel-title">New source</h2>
            <Field label="Name" error={errors.name}>
              {(control) => <input {...control} className="input" type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} />}
            </Field>
            <Field label="Connector" error={errors.definition}>
              {(control) => (
                <select {...control} className="select" value={form.definition} onChange={(e) => set({ definition: e.target.value })}>
                  {definitions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="API key" error={errors.apiKey} hint="Stored sealed; it is never shown again.">
              {(control) => <input {...control} className="input" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />}
            </Field>
            {!custom && (
              <Field label="Start date" error={errors.startDate} hint="YYYY-MM-DD">
                {(control) => <input {...control} className="input" type="text" inputMode="numeric" placeholder="2026-01-01" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
              </Field>
            )}
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating source…" : "Create source"}</button>
          </form>
        )}
      </div>
      <p role="status" aria-label="Source form status" className="status-line">{status}</p>
    </div>
  );
}
