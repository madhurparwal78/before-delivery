// The planner: survey area, geofence and plan settings by keyboard, a preview that follows the latest input,
// settings mirrored in the address, undo and redo of committed edits, and an error summary.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, idempotencyKey, NoResponse, Stale, type Position, type Units } from "../api";
import { Chart, type ChartLine } from "../components/Chart";
import { Popover } from "../components/Dialog";
import { useTier } from "../hooks";
import { navigate } from "../router";
import { useSession } from "../session";
import { fromLength, fromSpeed, lengthUnit, round, speedUnit } from "../units";

type Field = "name" | "client" | "date" | "area" | "fence" | "depth" | "ratio" | "overlap" | "azimuth" | "speed" | "order";
type Values = Record<Field, string>;

const LABELS: Record<Field, string> = {
  name: "Mission name", client: "Client", date: "Survey date", area: "Survey area vertices", fence: "Geofence corners",
  depth: "Planned depth", ratio: "Swath ratio", overlap: "Overlap", azimuth: "Line azimuth", speed: "Planned speed", order: "Survey order",
};
const SETTINGS: [Field, string][] = [["depth", "depth"], ["ratio", "ratio"], ["overlap", "overlap"], ["azimuth", "azimuth"], ["speed", "speed"], ["order", "order"]];
const API_FIELD: Record<string, Field> = {
  name: "name", survey_date: "date", survey_area: "area", geofence: "fence", planned_depth_m: "depth", swath_ratio: "ratio",
  overlap_pct: "overlap", line_azimuth_deg: "azimuth", planned_speed_mps: "speed", survey_order: "order",
};
const PREVIEW_FIELDS = new Set<Field>(["area", "depth", "ratio", "overlap", "azimuth", "speed", "order"]);
const ORDER_LABEL: Record<string, string> = { special: "Special Order", "1a": "Order 1a" };

interface Plan {
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
}

function parseVertices(text: string, units: Units): (Position | null)[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    return m ? { easting: fromLength(Number(m[1]), units), northing: fromLength(Number(m[2]), units) } : null;
  });
}

const num = (text: string) => (text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text));

function settingsBody(v: Values, units: Units) {
  const depth = num(v.depth);
  const speed = num(v.speed);
  return {
    planned_depth_m: depth === null ? null : fromLength(depth, units),
    swath_ratio: num(v.ratio),
    overlap_pct: num(v.overlap),
    line_azimuth_deg: num(v.azimuth),
    planned_speed_mps: speed === null ? null : fromSpeed(speed, units),
    survey_order: v.order,
  };
}

/** Draws the preview's lines from the server's plan figures: chords at the published offsets. */
function previewLines(area: Position[], azimuth: number, plan: Plan): ChartLine[] {
  const a = (azimuth * Math.PI) / 180;
  const along = [Math.sin(a), Math.cos(a)];
  const across = [Math.cos(a), -Math.sin(a)];
  const dot = (p: Position, d: number[]) => p.easting * d[0] + p.northing * d[1];
  const chord = (normal: number[], run: number[], value: number): [Position, Position] | null => {
    const ts: number[] = [];
    area.forEach((p, i) => {
      const q = area[(i + 1) % area.length];
      const fp = dot(p, normal) - value;
      const fq = dot(q, normal) - value;
      if (Math.abs(fp) < 1e-9) ts.push(dot(p, run));
      else if (fp * fq < 0) ts.push(dot(p, run) + (dot(q, run) - dot(p, run)) * (fp / (fp - fq)));
    });
    if (!ts.length) return null;
    const at = (t: number) => ({ easting: normal[0] * value + run[0] * t, northing: normal[1] * value + run[1] * t });
    return [at(Math.min(...ts)), at(Math.max(...ts))];
  };
  const p0 = Math.min(...area.map((p) => dot(p, across)));
  const spread = Math.max(...area.map((p) => dot(p, across))) - p0;
  const offsets = plan.line_count === 1 ? [spread / 2]
    : Array.from({ length: plan.line_count }, (_, i) => (i === plan.line_count - 1 ? spread - plan.swath_width_m / 2 : plan.swath_width_m / 2 + i * plan.line_spacing_m));
  const q0 = Math.min(...area.map((p) => dot(p, along)));
  const extent = Math.max(...area.map((p) => dot(p, along))) - q0;
  const out: ChartLine[] = [];
  offsets.forEach((o, i) => {
    const c = chord(across, along, p0 + o);
    if (c) out.push({ id: `L${i}`, label: `L${i + 1}`, kind: "planned", status: "Pending", start: c[0], end: c[1] });
  });
  for (let j = 0; j < plan.crossline_count; j++) {
    const c = chord(along, across, q0 + (extent * (j + 1)) / (plan.crossline_count + 1));
    if (c) out.push({ id: `X${j}`, label: `X${j + 1}`, kind: "crossline", status: "Pending", start: c[0], end: c[1] });
  }
  return out;
}

function initialValues(units: Units): Values {
  const q = new URLSearchParams(window.location.search);
  return {
    name: "", client: "", date: "", area: "", fence: "",
    depth: q.get("depth") ?? "",
    ratio: q.get("ratio") ?? "4",
    overlap: q.get("overlap") ?? "20",
    azimuth: q.get("azimuth") ?? "0",
    speed: q.get("speed") ?? (units === "metric" ? "2" : "3.9"),
    order: q.get("order") ?? "1a",
  };
}

export function NewMission() {
  const { user } = useSession();
  const tier = useTier();
  const units = user.units;
  const [values, setValues] = useState<Values>(() => initialValues(units));
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [shownFields, setShownFields] = useState<Set<Field>>(() => new Set(SETTINGS.filter(([, p]) => new URLSearchParams(window.location.search).has(p)).map(([f]) => f)));
  const [summary, setSummary] = useState<[Field, string][] | null>(null);
  const [preview, setPreview] = useState<{ text: string; plan: Plan | null }>({ text: "", plan: null });
  const [lastPlan, setLastPlan] = useState<{ plan: Plan; area: Position[]; azimuth: number } | null>(null);
  const [formStatus, setFormStatus] = useState("");
  const [help, setHelp] = useState<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const committed = useRef<Values>(values);
  const undo = useRef<{ field: Field; before: string; after: string }[]>([]);
  const redo = useRef<{ field: Field; before: string; after: string }[]>([]);
  const commitTimers = useRef<Partial<Record<Field, number>>>({});
  const previewTimer = useRef(0);
  const latestKey = useRef("");
  const createKey = useRef<{ body: string; key: string } | null>(null);
  const fieldRefs = useRef<Partial<Record<Field, HTMLElement | null>>>({});

  useEffect(() => {
    api<{ id: string; name: string }[]>("/api/client-orgs").then((r) => r.ok && setOrgs(r.data)).catch(() => undefined);
  }, []);

  // --- preview: only the response for the form's current values is shown ---
  const requestPreview = useCallback(() => {
    const v = valuesRef.current;
    const body = { ...settingsBody(v, units), survey_area: parseVertices(v.area, units) };
    const key = JSON.stringify(body);
    latestKey.current = key;
    setPreview((p) => ({ ...p, text: "Updating plan" }));
    api<Plan>("/api/plan-preview", { method: "POST", body }).then((r) => {
      if (latestKey.current !== key) return;
      if (r.ok) {
        setPreview({ text: `${r.data.line_count} lines · ${r.data.crossline_count} cross · ${round(r.data.estimated_duration_s / 60, 0)} min`, plan: r.data });
        setLastPlan({ plan: r.data, area: body.survey_area as Position[], azimuth: body.line_azimuth_deg ?? 0 });
        setErrors((e) => Object.fromEntries(Object.entries(e).filter(([f]) => !PREVIEW_FIELDS.has(f as Field))));
      } else if (r.status === 422) {
        setPreview({ text: "Fix the highlighted fields to see the plan", plan: null });
        const found: Partial<Record<Field, string>> = {};
        for (const [k, m] of Object.entries(r.error?.errors ?? {})) if (API_FIELD[k] && PREVIEW_FIELDS.has(API_FIELD[k])) found[API_FIELD[k]] = m;
        setErrors((e) => ({ ...Object.fromEntries(Object.entries(e).filter(([f]) => !PREVIEW_FIELDS.has(f as Field))), ...found }));
      }
    }).catch((e) => {
      if (!(e instanceof Stale) && !(e instanceof NoResponse)) throw e;
    });
  }, [units]);

  useEffect(() => {
    requestPreview();
  }, [requestPreview]);

  const schedulePreview = () => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(requestPreview, 250);
  };

  // --- committed edits: the address mirror and the undo history ---
  const mirror = () => {
    const v = valuesRef.current;
    const q = new URLSearchParams();
    for (const [field, param] of SETTINGS) q.set(param, v[field]);
    window.history.replaceState(window.history.state, "", `/missions/new?${q.toString()}`);
  };

  const commit = (field: Field) => {
    window.clearTimeout(commitTimers.current[field]);
    const now = valuesRef.current[field];
    const before = committed.current[field];
    if (now === before) return;
    committed.current = { ...committed.current, [field]: now };
    undo.current = [...undo.current, { field, before, after: now }].slice(-20);
    redo.current = [];
    mirror();
  };

  const change = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    valuesRef.current = { ...valuesRef.current, [field]: value };
    setShownFields((s) => (s.has(field) ? s : new Set(s).add(field)));
    window.clearTimeout(commitTimers.current[field]);
    commitTimers.current[field] = window.setTimeout(() => commit(field), 600);
    if (PREVIEW_FIELDS.has(field)) schedulePreview();
  };

  const shownValue = (field: Field, value: string) =>
    field === "order" ? ORDER_LABEL[value] ?? value : field === "client" ? orgs.find((o) => o.id === value)?.name ?? value : value;

  const step = (direction: "undo" | "redo") => {
    for (const field of Object.keys(commitTimers.current) as Field[]) commit(field);
    const from = direction === "undo" ? undo.current : redo.current;
    const entry = from[from.length - 1];
    if (!entry) {
      setFormStatus(direction === "undo" ? "Nothing to undo" : "Nothing to redo");
      return;
    }
    if (direction === "undo") {
      undo.current = undo.current.slice(0, -1);
      redo.current = [...redo.current, entry];
    } else {
      redo.current = redo.current.slice(0, -1);
      undo.current = [...undo.current, entry];
    }
    const value = direction === "undo" ? entry.before : entry.after;
    setValues((v) => ({ ...v, [entry.field]: value }));
    valuesRef.current = { ...valuesRef.current, [entry.field]: value };
    committed.current = { ...committed.current, [entry.field]: value };
    mirror();
    if (PREVIEW_FIELDS.has(entry.field)) schedulePreview();
    fieldRefs.current[entry.field]?.focus();
    setFormStatus(`${direction === "undo" ? "Undid" : "Redid"} ${LABELS[entry.field]}: ${value === "" ? "empty" : shownValue(entry.field, value)}`);
  };

  useLayoutEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);

  const create = async () => {
    for (const field of Object.keys(commitTimers.current) as Field[]) commit(field);
    const v = valuesRef.current;
    if (!v.client) {
      setErrors({ client: "Choose a client" });
      setSummary([["client", "Choose a client"]]);
      return;
    }
    const body = {
      name: v.name, client_org_id: v.client, survey_date: v.date,
      survey_area: parseVertices(v.area, units), geofence: parseVertices(v.fence, units), ...settingsBody(v, units),
    };
    const text = JSON.stringify(body);
    if (createKey.current?.body !== text) createKey.current = { body: text, key: idempotencyKey() };
    setFormStatus("Creating mission");
    try {
      const r = await api<{ id: string }>("/api/missions", { method: "POST", body, headers: { "Idempotency-Key": createKey.current.key } });
      if (r.ok) {
        navigate(`/missions/${r.data.id}/plan`);
        return;
      }
      setFormStatus("");
      const found: [Field, string][] = Object.entries(r.error?.errors ?? {}).filter(([k]) => API_FIELD[k]).map(([k, m]) => [API_FIELD[k], m]);
      setErrors(Object.fromEntries(found));
      setShownFields(new Set(found.map(([f]) => f)));
      setSummary(found.length ? found : [["name", r.error?.message ?? "The mission could not be created"]]);
    } catch (e) {
      if (e instanceof NoResponse) setFormStatus("Could not reach Swathdeck — the mission is not created yet");
      else if (!(e instanceof Stale)) throw e;
    }
  };

  const fieldError = (field: Field) => (shownFields.has(field) || summary ? errors[field] : undefined);
  const ref = (field: Field) => (el: HTMLElement | null) => {
    fieldRefs.current[field] = el;
  };
  const describe = (field: Field) => (fieldError(field) ? `${field}-error` : undefined);
  const errorLine = (field: Field) => fieldError(field) && <p id={`${field}-error`} className="field-error">{fieldError(field)}</p>;

  const numberField = (field: Field, unit: string, stepValue = "any") => (
    <div className="field">
      <label htmlFor={field}>{LABELS[field]}</label>
      <div className="with-unit">
        <input ref={ref(field)} id={field} type="number" step={stepValue} inputMode="decimal" value={values[field]} aria-describedby={describe(field)}
          aria-invalid={fieldError(field) ? true : undefined}
          onChange={(e) => change(field, e.target.value)} onBlur={() => commit(field)} />
        <span className="unit">{unit}</span>
      </div>
      {errorLine(field)}
    </div>
  );

  const vertexField = (field: "area" | "fence") => (
    <div className="field">
      <label htmlFor={field}>{LABELS[field]}</label>
      <textarea ref={ref(field)} id={field} className="vertices" value={values[field]} aria-describedby={describe(field)}
        aria-invalid={fieldError(field) ? true : undefined} spellCheck={false}
        onChange={(e) => change(field, e.target.value)} onBlur={() => commit(field)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void create();
          }
        }} />
      <div className="row">
        <button type="button" aria-expanded={help?.dataset.field === field} onClick={(e) => {
          const target = e.currentTarget;
          target.dataset.field = field;
          setHelp(help === target ? null : target);
        }}>Vertex format help</button>
      </div>
      {errorLine(field)}
    </div>
  );

  const areaPoints = parseVertices(values.area, units);
  const fencePoints = parseVertices(values.fence, units);
  const drawable = (pts: (Position | null)[]) => pts.length >= 3 && pts.every(Boolean) ? (pts as Position[]) : null;
  const chartArea = drawable(areaPoints);
  const chartData = {
    areas: chartArea ? [{ id: "draft", area: chartArea, fence: drawable(fencePoints) ?? [] }] : [],
    lines: lastPlan ? previewLines(lastPlan.area, lastPlan.azimuth, lastPlan.plan) : [],
  };

  return (
    <main className="page">
      <h1>New mission</h1>
      <div className={`planner ${tier === "wide" ? "" : "stacked"}`}>
        <form aria-label="New mission" noValidate onSubmit={(e) => { e.preventDefault(); void create(); }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
              e.preventDefault();
              step(e.shiftKey ? "redo" : "undo");
            }
          }}>
          {summary && (
            <div ref={summaryRef} className="summary" role="alert" tabIndex={-1} aria-labelledby="summary-heading">
              <h2 id="summary-heading">Fix these before creating the mission</h2>
              <ul>
                {summary.map(([field, message]) => (
                  <li key={field}><a href={`#${field}`} onClick={(e) => { e.preventDefault(); fieldRefs.current[field]?.focus(); }}>{message}</a></li>
                ))}
              </ul>
            </div>
          )}
          <div className="field">
            <label htmlFor="name">Mission name</label>
            <input ref={ref("name")} id="name" type="text" value={values.name} maxLength={200} aria-describedby={describe("name")}
              onChange={(e) => change("name", e.target.value)} onBlur={() => commit("name")} />
            {errorLine("name")}
          </div>
          <div className="field">
            <label htmlFor="client">Client</label>
            <select ref={ref("client")} id="client" value={values.client} onChange={(e) => {
              change("client", e.target.value);
              commit("client");
            }}>
              <option value="">Choose a client</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {errorLine("client")}
          </div>
          <div className="field">
            <label htmlFor="date">Survey date</label>
            <input ref={ref("date")} id="date" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={values.date} aria-describedby={describe("date")}
              onChange={(e) => change("date", e.target.value)} onBlur={() => commit("date")} />
            {errorLine("date")}
          </div>
          {vertexField("area")}
          {vertexField("fence")}
          <div className="settings">
            {numberField("depth", lengthUnit(units))}
            {numberField("ratio", "× depth")}
            {numberField("overlap", "%")}
            {numberField("azimuth", "°")}
            {numberField("speed", speedUnit(units))}
            <div className="field">
              <label htmlFor="order">Survey order</label>
              <select ref={ref("order")} id="order" value={values.order} onChange={(e) => {
                change("order", e.target.value);
                commit("order");
              }}>
                <option value="special">Special Order</option>
                <option value="1a">Order 1a</option>
              </select>
              {errorLine("order")}
            </div>
          </div>
          <div className="row">
            <button type="submit" className="primary">Create mission</button>
            <p role="status" aria-live="polite" aria-label="Form status">{formStatus}</p>
          </div>
        </form>
        <div className="preview-chart">
          <div className="chart-bar">
            <span className="caption">Plan preview</span>
            <p role="status" aria-live="polite" aria-label="Plan preview" className="num">{preview.text}</p>
          </div>
          <Chart data={chartData} units={units} followBounds />
        </div>
      </div>
      {help && (
        <Popover anchor={help} label="Vertex format" onClose={() => setHelp(null)}>
          <p>One vertex per line as easting, northing in {units === "metric" ? "metres" : "feet"}, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.</p>
        </Popover>
      )}
    </main>
  );
}
