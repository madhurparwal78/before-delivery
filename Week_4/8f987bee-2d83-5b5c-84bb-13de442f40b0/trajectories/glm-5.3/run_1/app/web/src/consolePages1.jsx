import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Status, StatusWord } from "./components.jsx";
import { api, ApiError, newIdempotencyKey, nextRunText } from "./api.js";
import { roleAtLeast, useUser } from "./console.jsx";

const OUTAGE_COPY = "Wayline can't reach its database right now. It keeps retrying on its own.";
const UNCONFIRMED_COPY = "Wayline couldn't confirm this action. Check the list before trying again.";
const PERMISSION_COPY = "You don't have permission to do that.";

/* ---------------------------------------------------------------- dashboard */

export function DashboardPage() {
  const { user, reload } = useUser();
  const [stats, setStats] = useState(null);
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState({});
  const [alert, setAlert] = useState("");

  const load = useCallback(async () => {
    try {
      const [statsRes, connectionsRes] = await Promise.all([
        api("/api/stats"),
        api("/api/connections"),
      ]);
      setStats(statsRes.data);
      setConnections(connectionsRes.data.connections);
      const jobMap = {};
      await Promise.all(connectionsRes.data.connections.map(async (connection) => {
        try {
          const { data } = await api(`/api/jobs?connection_id=${connection.id}&limit=1`);
          jobMap[connection.id] = data.jobs[0] || null;
        } catch {
          jobMap[connection.id] = null;
        }
      }));
      setJobs(jobMap);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) setAlert(OUTAGE_COPY);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const attention = connections.filter((c) => jobs[c.id]?.status === "failed").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h1>Connections</h1>
        {roleAtLeast(user?.role || "viewer", "editor") && (
          <Link to="/app/connections/new" className="btn btn-primary" style={{ marginLeft: "auto" }}>
            New connection
          </Link>
        )}
      </div>
      {alert && <Alert tone="error">{alert}</Alert>}
      <p className={`monitor-line ${attention ? "attention" : ""}`} role="status">
        {attention === 0 ? "All syncs healthy" : `${attention} connections need attention`}
      </p>
      <div className="health-grid">
        <div className="card card-pad">
          <span className="label-mono" style={{ color: "var(--muted)" }}>Records synced</span>
          <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)" }}>
            {stats ? (stats.records_synced ?? "—") : "—"}
          </div>
        </div>
        <div className="card card-pad">
          <span className="label-mono" style={{ color: "var(--muted)" }}>Latency</span>
          <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)" }}>
            {stats && stats.latency_seconds != null
              ? `${Math.round(stats.latency_seconds)}s` : "—"}
          </div>
        </div>
        <div className="card card-pad">
          <span className="label-mono" style={{ color: "var(--muted)" }}>Freshness</span>
          <div style={{ fontSize: "1.9rem", fontWeight: 700, color: "var(--ink)" }}>
            {stats && stats.freshness_seconds != null
              ? `${Math.round(stats.freshness_seconds)}s` : "—"}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "1.6rem" }}>
        {connections.map((connection) => {
          const job = jobs[connection.id];
          return (
            <Link key={connection.id} to={`/app/connections/${connection.id}`} className="row-link">
              <span>
                <span className="row-name">{connection.name}</span>
                <span className="row-sub" style={{ display: "block" }}>
                  {connection.source_name || "Source"} to {connection.destination_name || "destination"}
                </span>
              </span>
              <span className="row-cell"><StatusWord status={connection.status} /></span>
              <span className="row-cell">
                {job ? <StatusWord status={job.status} /> : <span style={{ color: "var(--muted)" }}>No jobs</span>}
              </span>
              <span className="row-cell">
                {nextRunText(connection.next_run_at, connection.schedule?.time_zone)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- wizard */

const MODE_LABELS = {
  full_refresh_overwrite: "Full refresh overwrite",
  full_refresh_append: "Full refresh append",
  incremental_append: "Incremental append",
  incremental_dedup: "Incremental dedup",
};

const DRAFT_KEY = "wayline_draft";

export function ConnectionWizardPage() {
  const { user, guard } = useUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [sources, setSources] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [streams, setStreams] = useState([]);
  const [form, setForm] = useState({
    source_id: "", destination_id: "", streamModes: {}, selected: {},
    scheduleType: "manual", intervalMinutes: 60, cronExpression: "", timeZone: "UTC",
    name: "", prefix: "", policy: "propagate",
  });
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const idemKey = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    guard("editor");
  }, [guard, user?.role]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!user) return;
    if (user && user.role !== "editor" && user.role !== "admin") return;
    try {
      const raw = window.sessionStorage.getItem(`${DRAFT_KEY}:${user.id}`);
      if (raw) {
        const draft = JSON.parse(raw);
        setForm(draft.form || {});
        setStep(draft.step || 1);
        window.sessionStorage.removeItem(`${DRAFT_KEY}:${user.id}`);
        setMessage("Signed in again. Your connection draft is restored.");
      }
    } catch {
      /* no draft */
    }
  }, [user?.id, user?.role, user]);

  const loadBasics = useCallback(async () => {
    const [sourcesRes, destinationsRes] = await Promise.all([
      api("/api/sources"), api("/api/destinations")]);
    setSources(sourcesRes.data.sources);
    setDestinations(destinationsRes.data.destinations);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadBasics().catch(() => {});
  }, [user, loadBasics]);

  const loadStreams = useCallback(async (sourceId) => {
    if (!sourceId) return;
    const { data } = await api(`/api/sources/${sourceId}/catalog`);
    setStreams(data.streams);
  }, []);

  useEffect(() => {
    loadStreams(form.source_id).catch(() => {});
  }, [form.source_id, loadStreams]);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const steps = [
    { id: 1, label: "Source" },
    { id: 2, label: "Destination" },
    { id: 3, label: "Streams" },
    { id: 4, label: "Schedule" },
  ];

  const validateStep = (nextStep) => {
    const next = {};
    if (nextStep > 1 && !form.source_id) next.source_id = "Choose a source.";
    if (nextStep > 2 && !form.destination_id) next.destination_id = "Choose a destination.";
    if (nextStep > 3 && !Object.values(form.selected).some(Boolean)) {
      next.streams = "Select at least one stream.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step + 1)) return;
    setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const submit = async () => {
    if (!idemKey.current) idemKey.current = newIdempotencyKey();
    setPending(true);
    setMessage("Creating connection…");
    setAlert("");
    setErrors({});
    const body = {
      name: form.name,
      source_id: form.source_id,
      destination_id: form.destination_id,
      namespace_prefix: form.prefix,
      streams: streams.map((stream) => {
        const mode = form.streamModes[stream.name] || stream.supported_sync_modes[0];
        const entry = {
          name: stream.name,
          selected: Boolean(form.selected[stream.name]),
          sync_mode: mode,
          primary_key: stream.primary_key,
        };
        if (mode.startsWith("incremental")) entry.cursor_field = "updated_at";
        return entry;
      }),
      schedule: form.scheduleType === "manual"
        ? { type: "manual" }
        : form.scheduleType === "interval"
          ? { type: "interval", interval_minutes: Number(form.intervalMinutes) }
          : { type: "cron", cron_expression: form.cronExpression, time_zone: form.timeZone },
      schema_change_policy: form.policy,
    };
    try {
      const { data } = await api("/api/connections", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": idemKey.current },
      });
      idemKey.current = null;
      try {
        window.sessionStorage.removeItem(`${DRAFT_KEY}:${user.id}`);
      } catch {
        /* nothing stored */
      }
      setMessage("Connection created");
      navigate(`/app/connections/${data.connection.id}`);
    } catch (error) {
      setPending(false);
      idemKey.current = null;
      if (error instanceof ApiError) {
        if (error.status === 401) {
          try {
            window.sessionStorage.setItem(`${DRAFT_KEY}:${user.id}`,
              JSON.stringify({ form, step }));
          } catch {
            /* storage unavailable */
          }
          return;
        }
        if (error.status === 503) {
          setAlert(OUTAGE_COPY);
          setMessage("");
          return;
        }
        if (error.status === 0) {
          setAlert(UNCONFIRMED_COPY);
          setMessage("");
          return;
        }
        if (error.status === 409 && error.code === "name_taken") {
          setErrors({ name: "A connection with this name already exists." });
          setStep(4);
          setMessage("");
          return;
        }
        if (error.status === 409 && error.code === "table_conflict") {
          setAlert("Another connection already writes <table> in this destination.");
          setMessage("");
          return;
        }
        if (error.status === 422 && error.code === "frequency_exceeds_plan") {
          setErrors({ schedule: "Your plan allows syncs at most every <min> minutes." });
          setStep(4);
          setMessage("");
          return;
        }
        if (error.status === 400) {
          setErrors(error.fields || {});
          const firstKey = Object.keys(error.fields || {})[0] || "";
          if (firstKey.startsWith("streams")) setStep(3);
          else if (firstKey.startsWith("schedule") || ["name", "namespace_prefix"].includes(firstKey)) {
            setStep(4);
          } else if (firstKey.includes("source")) setStep(1);
          else if (firstKey.includes("destination")) setStep(2);
          setMessage("");
          window.setTimeout(() => {
            const fieldId = firstKey.replace(/\./g, "-");
            document.getElementById(fieldId)?.focus();
          }, 40);
          return;
        }
        setAlert(UNCONFIRMED_COPY);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED_COPY);
        setMessage("");
      }
    }
  };

  return (
    <div>
      <h1>New connection</h1>
      <Status name="Connection form status" message={message} id="connection-form-status" />
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="conn-split wizard-split">
        <ol className="steps">
          {steps.map((entry) => (
            <li key={entry.id} aria-current={step === entry.id ? "step" : undefined}>
              <span className="step-num" aria-hidden="true">{entry.id}</span>
              {entry.label}
            </li>
          ))}
        </ol>
        <div className="card card-pad">
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: "1.2rem" }}>Source</h2>
              <div className="field">
                <label htmlFor="wizard-source">Source</label>
                <select id="wizard-source" className="select" value={form.source_id}
                  onChange={(e) => setField("source_id", e.target.value)}>
                  <option value="">Choose a source</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))}
                </select>
                {errors.source_id && <span className="field-error">{errors.source_id}</span>}
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: "1.2rem" }}>Destination</h2>
              <div className="field">
                <label htmlFor="wizard-destination">Destination</label>
                <select id="wizard-destination" className="select" value={form.destination_id}
                  onChange={(e) => setField("destination_id", e.target.value)}>
                  <option value="">Choose a destination</option>
                  {destinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>{destination.name}</option>
                  ))}
                </select>
                {errors.destination_id && <span className="field-error">{errors.destination_id}</span>}
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <h2 style={{ fontSize: "1.2rem" }}>Streams</h2>
              {streams.map((stream) => (
                <div key={stream.name} style={{ marginBottom: "0.8rem" }}>
                  <label className="check">
                    <input type="checkbox"
                      checked={Boolean(form.selected[stream.name])}
                      onChange={(e) => setField("selected", {
                        ...form.selected, [stream.name]: e.target.checked,
                      })} />
                    <span className="check-label">Sync {stream.name}</span>
                  </label>
                  <div className="field" style={{ marginLeft: "2rem", marginBottom: 0 }}>
                    <label htmlFor={`mode-${stream.name}`}>Sync mode for {stream.name}</label>
                    <select id={`mode-${stream.name}`} className="select"
                      value={form.streamModes[stream.name] || stream.supported_sync_modes[0]}
                      onChange={(e) => setField("streamModes", {
                        ...form.streamModes, [stream.name]: e.target.value,
                      })}>
                      {stream.supported_sync_modes.map((mode) => (
                        <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {errors.streams && <span className="field-error">{errors.streams}</span>}
            </div>
          )}
          {step === 4 && (
            <div>
              <h2 style={{ fontSize: "1.2rem" }}>Schedule</h2>
              <div className="field">
                <label htmlFor="wizard-schedule">Schedule</label>
                <select id="wizard-schedule" className="select" value={form.scheduleType}
                  onChange={(e) => setField("scheduleType", e.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="interval">Every N minutes</option>
                  <option value="cron">Cron</option>
                </select>
              </div>
              {form.scheduleType === "interval" && (
                <div className="field">
                  <label htmlFor="wizard-interval">Interval minutes</label>
                  <input id="wizard-interval" className="input" type="number" min={1} max={1440}
                    value={form.intervalMinutes}
                    onChange={(e) => setField("intervalMinutes", e.target.value)} />
                  {errors.schedule && <span className="field-error">{errors.schedule}</span>}
                </div>
              )}
              {form.scheduleType === "cron" && (
                <>
                  <div className="field">
                    <label htmlFor="wizard-cron">Cron expression</label>
                    <input id="wizard-cron" className="input" type="text"
                      value={form.cronExpression}
                      onChange={(e) => setField("cronExpression", e.target.value)} />
                    {errors.schedule?.cron_expression
                      && <span className="field-error">{errors.schedule.cron_expression}</span>}
                  </div>
                  <div className="field">
                    <label htmlFor="wizard-timezone">Time zone</label>
                    <select id="wizard-timezone" className="select" value={form.timeZone}
                      onChange={(e) => setField("timeZone", e.target.value)}>
                      {zoneOptions().map((zone) => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="wizard-name">Connection name</label>
                <input id="wizard-name" className="input" type="text" value={form.name}
                  onChange={(e) => setField("name", e.target.value)} />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="field">
                <label htmlFor="wizard-prefix">Namespace prefix</label>
                <input id="wizard-prefix" className="input" type="text" value={form.prefix}
                  onChange={(e) => setField("prefix", e.target.value)} />
                {errors.namespace_prefix && <span className="field-error">{errors.namespace_prefix}</span>}
              </div>
              <div className="field">
                <label htmlFor="wizard-policy">Schema change policy</label>
                <select id="wizard-policy" className="select" value={form.policy}
                  onChange={(e) => setField("policy", e.target.value)}>
                  <option value="propagate">Propagate</option>
                  <option value="ignore">Ignore</option>
                  <option value="pause">Pause</option>
                </select>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.4rem" }}>
            {step > 1 && <button type="button" className="btn btn-outline" onClick={goBack}>Back</button>}
            {step < 4 && <button type="button" className="btn btn-primary" onClick={goNext}>Next</button>}
            {step === 4 && (
              <button type="button" className="btn btn-primary" disabled={pending}
                onClick={submit}>
                {pending ? "Creating connection…" : "Create connection"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function zoneOptions() {
  const supported = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...supported.filter((z) => z !== "UTC").sort()];
}

