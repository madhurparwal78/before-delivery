import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Field from "../components/Field.jsx";
import { api, outageCopy } from "./api.js";
import { useConsole } from "./context.js";
import { draft } from "./draft.js";
import { SYNC_MODES } from "./format.js";
import { useIntent } from "./useIntent.js";

const STEPS = ["Source", "Destination", "Streams", "Schedule"];
const BLANK = {
  source: "", destination: "", streams: {}, schedule: "manual", interval: "60", cron: "", zone: "UTC",
  name: "", prefix: "", policy: "propagate",
};
const RESTORED = "Signed in again. Your connection draft is restored.";
const FULL_REFRESH = new Set(["full_refresh_overwrite", "full_refresh_append"]);
const STEP_OF = (field) => {
  if (field === "source") return 0;
  if (field === "destination") return 1;
  if (field.startsWith("stream:")) return 2;
  return 3;
};

function timeZones() {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC").sort()];
}

export default function Wizard() {
  const navigate = useNavigate();
  const { workspace, report, user } = useConsole();
  const intent = useIntent();
  // A draft kept when "Create connection" met a lost session comes back once, for its own user only.
  const [restored] = useState(() => draft.take(user.id));
  const [step, setStep] = useState(restored?.step ?? 0);
  const [sources, setSources] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState(restored?.form ?? BLANK);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [outage, setOutage] = useState("");
  const focusField = useRef(null);
  const fields = useRef({});
  const zones = useMemo(timeZones, []);

  useEffect(() => {
    if (restored) setStatus(RESTORED);
  }, [restored]);

  useEffect(() => {
    Promise.all([api("/api/sources"), api("/api/destinations")]).then(([s, d]) => {
      if (s.ok) setSources(s.body.sources);
      if (d.ok) setDestinations(d.body.destinations);
    });
  }, []);

  useEffect(() => {
    if (!form.source) return;
    api(`/api/sources/${form.source}/catalog`).then((result) => {
      if (!result.ok) return;
      setCatalog(result.body.streams);
      setForm((current) => ({
        ...current,
        streams: Object.fromEntries(result.body.streams.map((s) => [s.name, current.streams[s.name] ?? { selected: true, mode: "full_refresh_overwrite" }])),
      }));
    });
  }, [form.source]);

  useLayoutEffect(() => {
    if (focusField.current && fields.current[focusField.current]) {
      fields.current[focusField.current].focus();
      focusField.current = null;
    }
  });

  const change = (patch) => {
    intent.reset();
    setForm((current) => ({ ...current, ...patch }));
  };
  const setStream = (name, patch) => {
    intent.reset();
    setForm((current) => ({ ...current, streams: { ...current.streams, [name]: { ...current.streams[name], ...patch } } }));
  };
  const bind = (key) => (el) => { fields.current[key] = el; };

  const body = () => ({
    name: form.name,
    source_id: form.source,
    destination_id: form.destination,
    namespace_prefix: form.prefix,
    streams: catalog.map((s) => ({
      name: s.name,
      selected: form.streams[s.name]?.selected ?? false,
      sync_mode: form.streams[s.name]?.mode ?? "full_refresh_overwrite",
      cursor_field: s.cursor_field,
      primary_key: s.primary_key,
    })),
    schedule: form.schedule === "interval" ? { type: "interval", interval_minutes: Number(form.interval) }
      : form.schedule === "cron" ? { type: "cron", cron_expression: form.cron, time_zone: form.zone } : { type: "manual" },
    schema_change_policy: form.policy,
  });

  const fieldFor = (key) => {
    if (key.startsWith("schedule.interval") || (key === "schedule" && form.schedule === "interval")) return "interval";
    if (key.startsWith("schedule.cron") || (key === "schedule" && form.schedule === "cron")) return "cron";
    if (key.startsWith("schedule.time_zone")) return "zone";
    const known = { name: "name", namespace_prefix: "prefix", schema_change_policy: "policy", source_id: "source", destination_id: "destination" };
    if (known[key]) return known[key];
    if (key.startsWith("streams")) {
      const index = Number(key.split(".")[1]);
      return Number.isNaN(index) ? `stream:${catalog[0]?.name}` : `stream:${catalog[index]?.name}`;
    }
    return "schedule";
  };

  const refuse = (found) => {
    const first = Object.keys(found)[0];
    setErrors(found);
    setStep(STEP_OF(first));
    focusField.current = first;
  };

  const create = async () => {
    setPending(true);
    setStatus("Creating connection…");
    setOutage("");
    setErrors({});
    const result = await api("/api/connections", {
      method: "POST", body: body(), headers: { "Idempotency-Key": intent.key() },
      beforeLogin: () => draft.save(user.id, step, form),
    });
    intent.settle(result);
    setPending(false);
    if (result.ok) {
      draft.discard();
      setStatus("Connection created");
      navigate(`/app/connections/${result.body.connection.id}`, { state: { announce: "Connection created" } });
      return;
    }
    if (result.outage) {
      setStatus(outageCopy(result));
      setOutage(outageCopy(result));
      return;
    }
    const error = result.body?.error;
    setStatus("");
    if (error === "validation") {
      const found = {};
      for (const [key, message] of Object.entries(result.body.fields)) found[fieldFor(key)] ??= message;
      refuse(found);
    } else if (error === "name_taken") refuse({ name: "A connection with this name already exists." });
    else if (error === "table_conflict") refuse({ prefix: `Another connection already writes ${result.body.table} in this destination.` });
    else if (error === "frequency_exceeds_plan") {
      const message = `Your plan allows syncs at most every ${workspace?.min_interval_minutes} minutes.`;
      refuse({ [form.schedule === "cron" ? "cron" : "interval"]: message });
    } else report(result);
  };

  const custom = catalog.length > 0 && catalog.every((s) => s.cursor_field === null);
  const modes = SYNC_MODES.filter(([value]) => !custom || FULL_REFRESH.has(value));

  return (
    <div className="page wizard">
      <div className="page-head"><h1>New connection</h1></div>
      <ol className="steps">
        {STEPS.map((name, index) => (
          <li key={name} aria-current={index === step ? "step" : undefined} className={index < step ? "done" : ""}>
            <span className="label">{String(index + 1).padStart(2, "0")}</span> {name}
          </li>
        ))}
      </ol>
      {outage && <p role="alert" className="alert">{outage}</p>}
      <form className="panel wizard-panel" noValidate onSubmit={(e) => { e.preventDefault(); create(); }}>
        {step === 0 && (
          <Field label="Source" error={errors.source} hint="The system Wayline reads from.">
            {(control) => (
              <select {...control} ref={bind("source")} className="select" value={form.source} onChange={(e) => change({ source: e.target.value, streams: {} })}>
                <option value="">Choose a source</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </Field>
        )}
        {step === 1 && (
          <Field label="Destination" error={errors.destination} hint="The warehouse that receives the tables.">
            {(control) => (
              <select {...control} ref={bind("destination")} className="select" value={form.destination} onChange={(e) => change({ destination: e.target.value })}>
                <option value="">Choose a destination</option>
                {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </Field>
        )}
        {step === 2 && (
          <fieldset className="stream-picks">
            <legend className="field-label">Streams</legend>
            {catalog.length === 0 && <p>Choose a source first to see its streams.</p>}
            {catalog.map((s) => (
              <div className="stream-pick" key={s.name}>
                <label className="check">
                  <input type="checkbox" ref={bind(`stream:${s.name}`)} checked={form.streams[s.name]?.selected ?? false}
                    onChange={(e) => setStream(s.name, { selected: e.target.checked })} />
                  Sync {s.name}
                </label>
                <Field label={`Sync mode for ${s.name}`} error={errors[`stream:${s.name}`]}>
                  {(control) => (
                    <select {...control} className="select" value={form.streams[s.name]?.mode ?? "full_refresh_overwrite"}
                      onChange={(e) => setStream(s.name, { mode: e.target.value })}>
                      {modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  )}
                </Field>
              </div>
            ))}
          </fieldset>
        )}
        {step === 3 && (
          <div className="form-grid">
            <Field label="Schedule" error={errors.schedule}>
              {(control) => (
                <select {...control} ref={bind("schedule")} className="select" value={form.schedule} onChange={(e) => change({ schedule: e.target.value })}>
                  <option value="manual">Manual</option>
                  <option value="interval">Every N minutes</option>
                  <option value="cron">Cron</option>
                </select>
              )}
            </Field>
            {form.schedule === "interval" && (
              <Field label="Interval minutes" error={errors.interval} hint={`Your plan allows every ${workspace?.min_interval_minutes ?? "…"} minutes or slower.`}>
                {(control) => <input {...control} ref={bind("interval")} className="input" type="number" min="1" max="1440" value={form.interval} onChange={(e) => change({ interval: e.target.value })} />}
              </Field>
            )}
            {form.schedule === "cron" && (
              <>
                <Field label="Cron expression" error={errors.cron} hint="Five fields: minute hour day month weekday.">
                  {(control) => <input {...control} ref={bind("cron")} className="input code" type="text" value={form.cron} onChange={(e) => change({ cron: e.target.value })} />}
                </Field>
                <Field label="Time zone" error={errors.zone}>
                  {(control) => (
                    <select {...control} ref={bind("zone")} className="select" value={form.zone} onChange={(e) => change({ zone: e.target.value })}>
                      {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                    </select>
                  )}
                </Field>
              </>
            )}
            <Field label="Connection name" error={errors.name}>
              {(control) => <input {...control} ref={bind("name")} className="input" type="text" value={form.name} onChange={(e) => change({ name: e.target.value })} />}
            </Field>
            <Field label="Namespace prefix" error={errors.prefix} hint="Lowercase letters, digits and _; tables are named prefix + stream.">
              {(control) => <input {...control} ref={bind("prefix")} className="input code" type="text" value={form.prefix} onChange={(e) => change({ prefix: e.target.value })} />}
            </Field>
            <Field label="Schema change policy" error={errors.policy}>
              {(control) => (
                <select {...control} ref={bind("policy")} className="select" value={form.policy} onChange={(e) => change({ policy: e.target.value })}>
                  <option value="propagate">Propagate</option>
                  <option value="ignore">Ignore</option>
                  <option value="pause">Pause</option>
                </select>
              )}
            </Field>
          </div>
        )}
        <div className="form-actions">
          {step > 0 && <button type="button" className="btn btn-outline" onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1 && <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Next</button>}
          {step === STEPS.length - 1 && (
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating connection…" : "Create connection"}</button>
          )}
        </div>
        <p role="status" aria-label="Connection form status" className="status-line">{status}</p>
      </form>
    </div>
  );
}
