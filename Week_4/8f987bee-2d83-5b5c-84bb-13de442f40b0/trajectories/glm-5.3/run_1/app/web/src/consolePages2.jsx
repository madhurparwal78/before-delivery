import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Alert, Dialog, Field, Status, StatusWord, Tabs } from "./components.jsx";
import { api, ApiError, localTime, nextRunText } from "./api.js";
import { roleAtLeast, useUser } from "./console.jsx";

const DB_OUTAGE = "Wayline can't reach its database right now. It keeps retrying on its own.";
const UNCONFIRMED = "Wayline couldn't confirm this action. Check the list before trying again.";

/* ---------------------------------------------------------------- sources */

export function SourcesPage() {
  const { user, guard } = useUser();
  const [sources, setSources] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [name, setName] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState(false);
  const isEditor = roleAtLeast(user?.role || "viewer", "editor");

  const load = useCallback(async () => {
    try {
      const [sourcesRes, definitionsRes] = await Promise.all([
        api("/api/sources"), api("/api/connector-definitions")]);
      setSources(sourcesRes.data.sources);
      setDefinitions(definitionsRes.data.definitions.filter((d) => d.type === "source" && d.runnable));
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) setAlert(DB_OUTAGE);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setPending(true);
    setMessage("Creating source…");
    setAlert("");
    setErrors({});
    const config = { api_key: apiKey };
    const chosen = definitions.find((d) => d.id === definitionId);
    if (!chosen?.custom) config.start_date = startDate;
    try {
      await api("/api/sources", {
        method: "POST",
        body: { name, definition_id: definitionId, config },
      });
      setMessage("Source created");
      setName("");
      setApiKey("");
      setStartDate("");
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setErrors(error.fields || {});
        setMessage("");
      } else if (error instanceof ApiError && error.status === 422) {
        setErrors({ definition_id: "This connector is not installed." });
        setMessage("");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED);
        setMessage("");
      }
    } finally {
      setPending(false);
    }
  };

  const check = async (sourceId) => {
    setMessage(`Checking…`);
    try {
      const { data } = await api(`/api/sources/${sourceId}/check`, { method: "POST", body: {} });
      setMessage(data.status === "succeeded" ? "Check succeeded"
        : `Check failed: ${data.message || "The source rejected the request."}`);
    } catch (error) {
      setMessage("Check failed: The source rejected the request.");
    }
  };

  return (
    <div>
      <h1>Sources</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="conn-split sources-split">
        <div>
          {sources.map((source) => (
            <div key={source.id} className="card card-pad" style={{ marginBottom: "0.8rem" }}>
              <strong style={{ color: "var(--ink)" }}>{source.name}</strong>
              <p style={{ marginBottom: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
                {source.definition_id} · from {source.config?.start_date || "no start date"}
              </p>
              {isEditor && (
                <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: "0.7rem" }}
                  onClick={() => check(source.id)}>
                  Check
                </button>
              )}
            </div>
          ))}
        </div>
        {isEditor && (
          <form className="card card-pad" onSubmit={create}>
            <h2 style={{ fontSize: "1.1rem" }}>New source</h2>
            <Field label="Name" htmlFor="source-name" error={errors.name}>
              <input id="source-name" className="input" value={name}
                onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Connector" htmlFor="source-connector" error={errors.definition_id}>
              <select id="source-connector" className="select" value={definitionId}
                onChange={(e) => setDefinitionId(e.target.value)}>
                <option value="">Choose a connector</option>
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>{definition.name}</option>
                ))}
              </select>
            </Field>
            <Field label="API key" htmlFor="source-key" error={errors["config.api_key"]}>
              <input id="source-key" className="input" type="password" value={apiKey}
                onChange={(e) => setApiKey(e.target.value)} />
            </Field>
            <Field label="Start date" htmlFor="source-start" hint="YYYY-MM-DD"
              error={errors["config.start_date"]}>
              <input id="source-start" className="input" type="text" value={startDate}
                onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creating source…" : "Create source"}
            </button>
            <Status name="Source form status" message={message} id="source-form-status" />
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- destinations */

export function DestinationsPage() {
  const { user } = useUser();
  const [destinations, setDestinations] = useState([]);
  const [tables, setTables] = useState({});

  useEffect(() => {
    api("/api/destinations").then(({ data }) => {
      setDestinations(data.destinations);
      return Promise.all(data.destinations.map(async (destination) => {
        try {
          const res = await api(`/api/destinations/${destination.id}/tables`);
          setTables((current) => ({ ...current, [destination.id]: res.data.tables }));
        } catch {
          setTables((current) => ({ ...current, [destination.id]: [] }));
        }
      }));
    }).catch(() => {});
  }, [user?.id]);

  return (
    <div>
      <h1>Destinations</h1>
      {destinations.map((destination) => (
        <div key={destination.id} className="card card-pad" style={{ marginBottom: "1rem" }}>
          <strong style={{ color: "var(--ink)" }}>{destination.name}</strong>
          <table className="table" style={{ marginTop: "0.8rem" }}>
            <caption className="visually-hidden">{destination.name} tables</caption>
            <thead>
              <tr><th scope="col">Table</th><th scope="col">Rows</th></tr>
            </thead>
            <tbody>
              {(tables[destination.id] || []).map((table) => (
                <tr key={table.name}>
                  <th scope="row">
                    <Link to={`/app/destinations/${destination.id}/tables/${table.name}`}>
                      {table.name}
                    </Link>
                  </th>
                  <td className="num">{table.row_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- table records */

export function TablePage() {
  const { destinationId, table } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useUser();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [alert, setAlert] = useState("");
  const [message, setMessage] = useState("");
  const cursor = params.get("cursor") || "";

  const load = useCallback(async (cursorValue) => {
    setMessage("Loading records…");
    try {
      const query = `?limit=50${cursorValue ? `&cursor=${encodeURIComponent(cursorValue)}` : ""}`;
      const res = await api(`/api/destinations/${destinationId}/tables/${table}/records${query}`);
      setData(res.data);
      setMessage("Page loaded");
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        setMissing(true);
      }
    }
  }, [destinationId, table]);

  useEffect(() => {
    load(cursor);
  }, [cursor, load]);

  if (missing) {
    return (
      <div className="not-found">
        <h1>Table not found</h1>
        <Link to="/app/destinations" className="btn btn-outline">Back to destinations</Link>
      </div>
    );
  }
  if (!data) {
    return <p className="status-line" role="status" aria-live="polite">{message}</p>;
  }

  const records = data.records || [];
  const columns = records.length
    ? Object.keys(records[0]) : [];

  return (
    <div>
      <h1>{table} records</h1>
      <p>{data.total_count} records</p>
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="records-frame" role="region" aria-label={`Scroll ${table} records`}
        tabIndex={0} onKeyDown={(e) => {
          const frame = e.currentTarget;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            frame.scrollLeft += 80;
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            frame.scrollLeft -= 80;
          }
        }}>
        <table className="table records-table">
          <caption className="visually-hidden">{table} records</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                {columns.map((column) => (
                  <td key={column} className={column === "id" ? "" : "num"}>{String(record[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        <button type="button" className="btn btn-outline" disabled={!data.prev_cursor}
          onClick={() => {
            setParams({ cursor: data.prev_cursor });
          }}>
          Previous page
        </button>
        <button type="button" className="btn btn-outline" disabled={!data.has_more}
          onClick={() => {
            setParams({ cursor: data.next_cursor });
          }}>
          Next page
        </button>
      </div>
      <Status name="Records status" message={message} id="records-status" />
    </div>
  );
}
