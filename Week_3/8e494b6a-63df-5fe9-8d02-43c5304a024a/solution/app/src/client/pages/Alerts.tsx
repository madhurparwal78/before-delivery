// Alerts: rules and recent cases, a rule's groups and history, the new rule form and maintenance windows.
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { useShown } from "../lib/format";
import { useLive } from "../lib/live";
import { EASE_OUT, play } from "../lib/motion";
import { Link, navigate } from "../lib/router";
import { announce, useAppState } from "../lib/store";
import { Badge, Button, EmptyBand, ErrorSummary, Field, LoadFailed, Skeleton, stateTone, useBusy } from "../lib/ui";
import { useBand } from "../lib/viewport";
import { useResource } from "../lib/useResource";
import { AddToCaseDialog, type CaseTarget } from "./AddToCase";
import { caseLabel, type CaseSummary } from "./Cases";

interface Group {
  group: string;
  state: string;
  flapping: boolean;
  snoozed: boolean;
  snoozed_until: string | null;
  in_maintenance: boolean;
  acknowledged_by: string | null;
}
interface LastCheck { at: string; failed: boolean }
interface HistoryEntry { at: string; group: string; from: string; to: string }
interface RuleSummary { id: number; name: string; stream: string; groups: Group[]; last_check: LastCheck | null }
interface RuleDetail extends RuleSummary { history: HistoryEntry[]; measure: string; comparison: string; threshold: number; window_ms: number }

const groupLabel = (group: Group): string =>
  `Group ${group.group}, ${group.state}${group.flapping ? ", flapping" : ""}${group.snoozed ? ", snoozed" : ""}${group.in_maintenance ? ", in maintenance" : ""}`;

function GroupBadges({ group }: { group: Group }) {
  return (
    <>
      <Badge tone={stateTone(group.state)}>{group.state}</Badge>
      {group.flapping ? <Badge tone="warning">flapping</Badge> : null}
      {group.snoozed ? <Badge tone="info">snoozed</Badge> : null}
      {group.in_maintenance ? <Badge tone="info">in maintenance</Badge> : null}
    </>
  );
}

export function AlertsPage() {
  const rules = useResource(() => api.get<{ rules: RuleSummary[] }>("/api/rules"), []);
  const cases = useResource(() => api.get<{ cases: CaseSummary[] }>("/api/cases"), []);
  const shown = useShown();
  const editor = useAppState((s) => s.me?.space.role !== "viewer");
  useLive(["case"], (data) => {
    const item = data.case as CaseSummary;
    cases.set((current) => {
      const rows = current?.cases ?? [];
      return { cases: (rows.some((c) => c.number === item.number) ? rows.map((c) => (c.number === item.number ? item : c)) : [item, ...rows]).sort((a, b) => b.number - a.number) };
    });
  });
  useLive(["alert"], (data) => {
    const check = data.last_check as LastCheck | undefined;
    rules.set((current) => current && {
      rules: current.rules.map((rule) => rule.id !== data.rule ? rule : {
        ...rule, last_check: check ?? rule.last_check,
        groups: [...rule.groups.filter((g) => !(data.groups as Group[]).some((n) => n.group === g.group)), ...(data.groups as Group[])].sort((a, b) => (a.group < b.group ? -1 : 1)),
      }),
    });
  });
  const empty = rules.data?.rules.length === 0;
  const newRule = <Link to="/alerts/new" className={`btn ${empty ? "btn-primary" : "btn-outline"}`}>New rule</Link>;
  const recent = cases.data?.cases.slice(0, 3) ?? [];
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Alerts</h1>
        {empty || !editor ? null : newRule}
        <Link to="/alerts/maintenance" className="btn btn-outline">Maintenance windows</Link>
      </div>
      <section role="region" aria-label="Recent cases" className="recent-cases">
        {recent.map((c) => (
          <article key={c.number} className="card" aria-label={caseLabel(c)}>
            <p className="mono small muted">Case {c.number}</p>
            <h3><Link to={`/cases/${c.number}`}>{c.title}</Link></h3>
            <Badge tone="plain">{c.status}</Badge>
          </article>
        ))}
        {cases.data && recent.length === 0 ? <p className="muted">No cases yet.</p> : null}
      </section>
      {rules.error ? <LoadFailed failure={rules.error} onRetry={rules.reload} /> : null}
      {!rules.data && !rules.error ? <Skeleton /> : null}
      {empty ? <EmptyBand line="No alert rules yet.">{newRule}</EmptyBand> : null}
      {rules.data && !empty ? (
        <div className="table-wrap">
          <table className="data" aria-label="Rules">
            <thead><tr><th scope="col">Rule</th><th scope="col">Stream</th><th scope="col">Groups</th><th scope="col">Last check</th></tr></thead>
            <tbody>
              {rules.data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td><Link to={`/alerts/${rule.id}`}>{rule.name}</Link></td><td className="mono">{rule.stream}</td>
                  <td>{rule.groups.length === 0 ? <span className="muted">none yet</span> : rule.groups.map((g) => <span key={g.group} className="mono small"><Badge tone={stateTone(g.state)}>{g.group}: {g.state}</Badge></span>)}</td>
                  <td className="mono small">{rule.last_check ? shown(rule.last_check.at) : "not checked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const MEASURES = ["count", "avg", "max", "min", "sum"];
const FILTER_OPS = ["eq", "ne", "exists", "gt", "gte", "lt", "lte"];
const COMPARISONS = [">", ">=", "<", "<="];

export function NewRulePage() {
  const streams = useResource(() => api.get<{ streams: Array<{ name: string }> }>("/api/streams"), []);
  const [values, setValues] = useState({
    name: "", stream: "", filterField: "", filterOp: "eq", filterValue: "", measure: "count", measureField: "", groupBy: "",
    windowMs: "300000", comparison: ">", threshold: "0", frequency: "change", intervalMs: "60000",
  });
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const set = (key: keyof typeof values) => (event: { target: { value: string } }): void => setValues({ ...values, [key]: event.target.value });
  const stream = values.stream || streams.data?.streams[0]?.name || "";
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      const numeric = (text: string): number | string => (text.trim() !== "" && !Number.isNaN(Number(text)) ? Number(text) : text);
      const body = {
        name: values.name, stream, filter: values.filterField.trim() === "" ? null : { field: values.filterField, op: values.filterOp, value: numeric(values.filterValue) },
        measure: values.measure, measure_field: values.measure === "count" ? null : values.measureField, group_by: values.groupBy.trim() === "" ? null : values.groupBy,
        window_ms: Number(values.windowMs), comparison: values.comparison, threshold: Number(values.threshold),
        frequency: values.frequency === "throttle" ? { kind: "throttle", every_ms: Number(values.intervalMs) } : { kind: values.frequency },
      };
      try {
        const made = await api.post<{ id: number }>("/api/rules", body);
        announce(`Rule ${values.name} saved.`);
        navigate(`/alerts/${made.id}`);
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  const fe = failure?.fields ?? {};
  return (
    <div className="stack narrow-wide">
      <div className="page-head"><h1>New rule</h1><Link to="/alerts">All rules</Link></div>
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Rule name", stream: "Stream", measure: "Measure", measure_field: "Measure field", window_ms: "Window (ms)", comparison: "Comparison", threshold: "Threshold", frequency: "Action frequency", filter: "Filter field" }} />
        <Field label="Rule name" error={fe.name}>{(p) => <input {...p} type="text" data-field="name" value={values.name} onChange={set("name")} />}</Field>
        <Field label="Stream" error={fe.stream}>
          {(p) => <select {...p} data-field="stream" value={stream} onChange={set("stream")}>{streams.data?.streams.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select>}
        </Field>
        <div className="grid-fields">
          <Field label="Filter field" error={fe.filter}>{(p) => <input {...p} type="text" data-field="filter" className="mono" value={values.filterField} onChange={set("filterField")} />}</Field>
          <Field label="Filter operator">{(p) => <select {...p} value={values.filterOp} onChange={set("filterOp")}>{FILTER_OPS.map((op) => <option key={op} value={op}>{op}</option>)}</select>}</Field>
          <Field label="Filter value">{(p) => <input {...p} type="text" className="mono" value={values.filterValue} onChange={set("filterValue")} />}</Field>
        </div>
        <div className="grid-fields">
          <Field label="Measure" error={fe.measure}>{(p) => <select {...p} data-field="measure" value={values.measure} onChange={set("measure")}>{MEASURES.map((m) => <option key={m} value={m}>{m}</option>)}</select>}</Field>
          <Field label="Measure field" error={fe.measure_field}>{(p) => <input {...p} type="text" data-field="measure_field" className="mono" value={values.measureField} onChange={set("measureField")} />}</Field>
          <Field label="Group by">{(p) => <input {...p} type="text" className="mono" value={values.groupBy} onChange={set("groupBy")} />}</Field>
        </div>
        <div className="grid-fields">
          <Field label="Window (ms)" error={fe.window_ms}>{(p) => <input {...p} type="text" inputMode="numeric" data-field="window_ms" className="mono" value={values.windowMs} onChange={set("windowMs")} />}</Field>
          <Field label="Comparison" error={fe.comparison}>{(p) => <select {...p} data-field="comparison" value={values.comparison} onChange={set("comparison")}>{COMPARISONS.map((c) => <option key={c} value={c}>{c}</option>)}</select>}</Field>
          <Field label="Threshold" error={fe.threshold}>{(p) => <input {...p} type="text" inputMode="decimal" data-field="threshold" className="mono" value={values.threshold} onChange={set("threshold")} />}</Field>
        </div>
        <Field label="Action frequency" error={fe.frequency}>
          {(p) => (
            <select {...p} data-field="frequency" value={values.frequency} onChange={set("frequency")}>
              <option value="change">On status change</option>
              <option value="check">Every check</option>
              <option value="throttle">At most every {"<n>"} ms</option>
            </select>
          )}
        </Field>
        {values.frequency === "throttle" ? <Field label="Interval (ms)" error={fe.frequency}>{(p) => <input {...p} type="text" inputMode="numeric" className="mono" value={values.intervalMs} onChange={set("intervalMs")} />}</Field> : null}
        <div><button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Save rule</button></div>
      </form>
    </div>
  );
}

function SnoozeDialog({ ruleId, group, onClose, onDone }: { ruleId: number; group: string; onClose: () => void; onDone: (updated: Group) => void }) {
  const [choice, setChoice] = useState<"1h" | "1d" | "recovered">("1h");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const shown = useShown();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        const updated = await api.post<Group>(`/api/rules/${ruleId}/groups/${encodeURIComponent(group)}/snooze`, { for: choice });
        announce(choice === "recovered" ? `Group ${group} snoozed until it recovers.` : `Group ${group} snoozed until ${shown(updated.snoozed_until as string)}.`);
        onDone(updated);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  const options: Array<["1h" | "1d" | "recovered", string]> = [["1h", "For 1 hour"], ["1d", "For 1 day"], ["recovered", "Until recovered"]];
  return (
    <Modal label="Snooze" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} />
        <fieldset role="radiogroup" aria-label="Snooze length">
          {options.map(([value, label]) => (
            <label key={value} className="check"><input type="radio" name="snooze" checked={choice === value} onChange={() => setChoice(value)} />{label}</label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Snooze</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

const SWIPE_MIN = 80;
const SWIPE_DRIFT = 40;

function GroupCard({ group, rule, onAcknowledge, onSnooze, onCase }: { group: Group; rule: string; onAcknowledge: () => void; onSnooze: () => void; onCase: () => void }) {
  const card = useRef<HTMLElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  useEffect(() => {
    const element = card.current as HTMLElement;
    let origin: Touch | null = null;
    const begin = (event: TouchEvent): void => {
      origin = event.touches[0] ?? null;
    };
    const drag = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (origin && touch && Math.abs(touch.clientX - origin.clientX) > Math.abs(touch.clientY - origin.clientY) && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchstart", begin, { passive: true });
    element.addEventListener("touchmove", drag, { passive: false });
    return () => {
      element.removeEventListener("touchstart", begin);
      element.removeEventListener("touchmove", drag);
    };
  }, []);
  const down = (event: ReactPointerEvent<HTMLElement>): void => {
    start.current = { x: event.clientX, y: event.clientY };
    moved.current = 0;
  };
  const move = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    if (Math.abs(dx) < 8 && moved.current === 0) return;
    moved.current = Math.min(0, dx);
    (card.current as HTMLElement).style.transform = `translateX(${moved.current}px)`;
  };
  const release = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
    const origin = start.current;
    start.current = null;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const element = card.current as HTMLElement;
    const from = moved.current;
    element.style.transform = "";
    if (!cancelled && dx < -SWIPE_MIN && Math.abs(dy) < SWIPE_DRIFT) onAcknowledge();
    else play(element, "swipe-spring", [{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], 200, EASE_OUT);
  };
  return (
    <article ref={card} className="card group-card" aria-label={groupLabel(group)} onPointerDown={down} onPointerMove={move} onPointerUp={(e) => release(e, false)} onPointerCancel={(e) => release(e, true)}>
      <p className="mono"><strong>{group.group}</strong> <GroupBadges group={group} /></p>
      <p className="small muted">{rule}{group.acknowledged_by ? ` - acknowledged by ${group.acknowledged_by}` : ""}</p>
      <div className="item-actions">
        <Button onClick={onAcknowledge}>Acknowledge</Button>
        <Button onClick={onSnooze}>Snooze group</Button>
        <Button onClick={onCase}>Add to case</Button>
      </div>
    </article>
  );
}

export function RulePage({ id }: { id: string }) {
  const detail = useResource(() => api.get<RuleDetail>(`/api/rules/${id}`), [id]);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [adding, setAdding] = useState<CaseTarget | null>(null);
  const shown = useShown();
  const band = useBand();
  const editor = useAppState((s) => s.me?.space.role !== "viewer");
  const [rule, setRule] = useState<RuleDetail | null>(null);
  useEffect(() => setRule(detail.data), [detail.data]);

  useLive(["alert"], (data) => {
    if (String(data.rule) !== id) return;
    setRule((current) => {
      if (!current) return current;
      const incoming = data.groups as Group[];
      const entries = data.history as HistoryEntry[];
      const known = new Set(current.history.map((h) => `${h.at}|${h.group}|${h.from}|${h.to}`));
      return {
        ...current,
        last_check: (data.last_check as LastCheck | undefined) ?? current.last_check,
        groups: [...current.groups.filter((g) => !incoming.some((n) => n.group === g.group)), ...incoming].sort((a, b) => (a.group < b.group ? -1 : 1)),
        history: [...current.history, ...entries.filter((h) => !known.has(`${h.at}|${h.group}|${h.from}|${h.to}`))],
      };
    });
  });

  const replace = (updated: Group): void =>
    setRule((current) => current && { ...current, groups: current.groups.map((g) => (g.group === updated.group ? { ...g, ...updated } : g)) });
  const acknowledge = async (group: Group): Promise<void> => replace(await api.post<Group>(`/api/rules/${id}/groups/${encodeURIComponent(group.group)}/ack`));
  const caseTarget = (group: Group): CaseTarget => ({ rule: Number(id), group: group.group, title: `Group ${group.group} on rule ${rule?.name ?? ""}` });
  const check = rule?.last_check;

  return (
    <div className="stack">
      <div className="page-head"><h1>{rule?.name ?? "Rule"}</h1><Link to="/alerts">All rules</Link></div>
      {detail.error ? <LoadFailed failure={detail.error} onRetry={detail.reload} /> : null}
      {rule ? (
        <>
          <p className="muted small mono">{rule.measure} {rule.comparison} {rule.threshold} over {rule.window_ms} ms on {rule.stream}</p>
          <p role="status" aria-label="Last check" className="notice mono">
            {check ? (check.failed ? `Check failed at ${shown(check.at)}: state kept.` : `Last check at ${shown(check.at)}: ok`) : "No check has run yet."}
          </p>
          <h2>Groups</h2>
          {rule.groups.length === 0 ? <p className="muted">No groups yet. Groups appear at the first check where they have events.</p> : null}
          {rule.groups.length > 0 && band === "phone" ? (
            <div className="stack">
              {rule.groups.map((group) => (
                <GroupCard key={group.group} group={group} rule={rule.name} onAcknowledge={() => void acknowledge(group)} onSnooze={() => setSnoozing(group.group)} onCase={() => setAdding(caseTarget(group))} />
              ))}
            </div>
          ) : null}
          {band !== "phone" ? (
            <div className="table-wrap">
              <table className="data" aria-label="Groups">
                <thead><tr><th scope="col">Group</th><th scope="col">State</th><th scope="col">Acknowledged</th><th scope="col" /></tr></thead>
                <tbody>
                  {rule.groups.map((group) => (
                    <tr key={group.group} aria-label={groupLabel(group)}>
                      <td className="mono">{group.group}</td><td><GroupBadges group={group} /></td><td className="small">{group.acknowledged_by ?? ""}</td>
                      <td>
                        <Button disabled={!editor} onClick={() => void acknowledge(group)}>Acknowledge</Button>
                        <Button disabled={!editor} onClick={() => setSnoozing(group.group)}>Snooze group</Button>
                        <Button disabled={!editor} onClick={() => setAdding(caseTarget(group))}>Add to case</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <h2>State history</h2>
          <div className="table-wrap">
            <table className="data" aria-label="State history">
              <thead><tr><th scope="col">Check</th><th scope="col">Group</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
              <tbody>
                {[...rule.history].reverse().map((entry, k) => (
                  <tr key={k}><td className="mono">{shown(entry.at)}</td><td className="mono">{entry.group}</td><td>{entry.from}</td><td>{entry.to}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !detail.error ? <Skeleton /> : null}
      {snoozing ? <SnoozeDialog ruleId={Number(id)} group={snoozing} onClose={() => setSnoozing(null)} onDone={replace} /> : null}
      {adding ? <AddToCaseDialog target={adding} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}

const DAYS: Array<[string, string]> = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

interface WindowRow { id: number; name: string; rule_name: string; next_start: string | null }

export function MaintenancePage() {
  const windows = useResource(() => api.get<{ maintenance: WindowRow[] }>("/api/maintenance"), []);
  const rules = useResource(() => api.get<{ rules: RuleSummary[] }>("/api/rules"), []);
  const [name, setName] = useState("");
  const [zone, setZone] = useState(useAppState((s) => s.me?.time_zone ?? "UTC"));
  const [days, setDays] = useState<string[]>([]);
  const [start, setStart] = useState("02:00");
  const [duration, setDuration] = useState("3600000");
  const [rule, setRule] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const shown = useShown();
  const zones = [...new Set(["UTC", zone, ...Intl.supportedValuesOf("timeZone")])].sort();
  const ruleId = rule || String(rules.data?.rules[0]?.id ?? "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        setFailure(null);
        await api.post("/api/maintenance", { name, time_zone: zone, days, start, duration_ms: Number(duration), rule: ruleId });
        announce(`Maintenance window ${name} saved.`);
        windows.reload();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  const fe = failure?.fields ?? {};
  return (
    <div className="stack narrow-wide">
      <div className="page-head"><h1>Maintenance windows</h1><Link to="/alerts">All rules</Link></div>
      <form onSubmit={submit} className="stack" noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Name", time_zone: "Window time zone", days: "Weekly days", start: "Start (HH:MM)", duration_ms: "Duration (ms)", rule: "Rule" }} />
        <Field label="Name" error={fe.name}>{(p) => <input {...p} type="text" data-field="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Window time zone" error={fe.time_zone}>{(p) => <select {...p} data-field="time_zone" value={zone} onChange={(e) => setZone(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select>}</Field>
        <fieldset role="group" aria-labelledby="weekly-days" data-field="days">
          <legend id="weekly-days">Weekly days</legend>
          <div className="check-row">
            {DAYS.map(([value, label]) => (
              <label key={value} className="check"><input type="checkbox" checked={days.includes(value)} onChange={(e) => setDays(e.target.checked ? [...days, value] : days.filter((d) => d !== value))} />{label}</label>
            ))}
          </div>
          {fe.days ? <p className="field-error">{fe.days}</p> : null}
        </fieldset>
        <div className="grid-fields">
          <Field label="Start (HH:MM)" error={fe.start}>{(p) => <input {...p} type="text" data-field="start" className="mono" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Duration (ms)" error={fe.duration_ms}>{(p) => <input {...p} type="text" inputMode="numeric" data-field="duration_ms" className="mono" value={duration} onChange={(e) => setDuration(e.target.value)} />}</Field>
        </div>
        <Field label="Rule" error={fe.rule}>{(p) => <select {...p} data-field="rule" value={ruleId} onChange={(e) => setRule(e.target.value)}>{rules.data?.rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}</Field>
        <div><button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Save window</button></div>
      </form>
      {windows.error ? <LoadFailed failure={windows.error} onRetry={windows.reload} /> : null}
      <div className="table-wrap">
        <table className="data" aria-label="Maintenance windows">
          <thead><tr><th scope="col">Name</th><th scope="col">Rule</th><th scope="col">Next start</th></tr></thead>
          <tbody>{windows.data?.maintenance.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.rule_name}</td><td className="mono">{w.next_start ? shown(w.next_start) : "none"}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
