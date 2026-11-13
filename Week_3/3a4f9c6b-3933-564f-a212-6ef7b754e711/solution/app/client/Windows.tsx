// Windows and freezes: one panel per cluster, the Check an instant form and the freeze policy.
// Readable by every member; editable by platform engineers.
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { type Cluster, DAYS, type Day, type FreezePolicy, type FreezeVersion, type Opening, type SessionBody, type SyncWindow, type WindowDecision } from "../shared/api";
import { clusterTime, localToInstant } from "../shared/zone";
import { call } from "./api";
import { Dialog, FieldError } from "./Dialog";
import { activity, generalError, problem, useFeedback, verdict } from "./feedback";
import { useEvery } from "./hooks";
import { Shell } from "./Shell";

const DAY_BOXES = DAYS.map((key) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) }));
const LOCAL = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;
/** A freeze policy instant: cluster time format with the zone `UTC`, which may be left off. */
const UTC_LOCAL = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: UTC)?$/;

/** `YYYY-MM-DD HH:mm[ UTC]` typed as UTC, as an ISO instant; null when it is not in that form. */
function utcInstant(value: string): string | null {
  const match = UTC_LOCAL.exec(value.trim());
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}:00.000Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function errorFields(result: { ok: boolean; error?: { fields?: Record<string, string> } | null }): Record<string, string> {
  return (!result.ok && result.error?.fields) || {};
}

function AddWindowDialog({ slug, cluster, onClose, onDone }: { slug: string; cluster: Cluster; onClose: () => void; onDone: () => Promise<void> }) {
  const say = useFeedback();
  const id = useId();
  const [days, setDays] = useState<Day[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    say(activity("Saving window…"));
    const result = await call<SyncWindow>("POST", `/api/projects/${slug}/clusters/${cluster.name}/windows`,
      { body: { label, days: DAYS.filter((d) => days.includes(d)), start, end } });
    if (!result.ok) {
      setBusy(false);
      setFields(errorFields(result));
      say(problem(result.error?.error === "validation" ? Object.values(result.error.fields ?? {}).join(" ") : generalError(result)));
      return;
    }
    const next = await call<{ openings: Opening[] }>("GET", `/api/projects/${slug}/clusters/${cluster.name}/window-openings?count=20`);
    const first = next.ok ? next.data.openings.find((o) => o.window_id === result.data.id) : undefined;
    await onDone();
    say(activity(first ? `Window added. Next opening ${first.local_opens} ${cluster.time_zone}.` : "Window added. No openings scheduled."));
  };
  const text = (name: "start" | "end" | "label", title: string, value: string, set: (v: string) => void, hint?: string) => (
    <div className="field">
      <label className="field-inner">
      <span className="field-label">{title}</span>
      <input type="text" value={value} placeholder={hint} onChange={(event) => set(event.target.value)}
        aria-describedby={`${id}-${name}`} aria-invalid={fields[name] ? true : undefined} />
    </label>
      <FieldError id={`${id}-${name}`} message={fields[name]} />
    </div>
  );
  return (
    <Dialog title={`Add window to ${cluster.name}`} onClose={onClose} onSubmit={() => void save()}
      actions={<>
        <button type="submit" className="button primary" disabled={busy}>Save window</button>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
      </>}>
      <fieldset className="days" aria-describedby={`${id}-days`}>
        <legend className="field-label">{`Days (${cluster.time_zone})`}</legend>
        <div className="day-boxes">
          {DAY_BOXES.map((d) => (
            <label key={d.key} className="check">
              <input type="checkbox" checked={days.includes(d.key)}
                onChange={(event) => setDays(event.target.checked ? [...days, d.key] : days.filter((x) => x !== d.key))} />
              <span>{d.label}</span>
            </label>
          ))}
        </div>
        <FieldError id={`${id}-days`} message={fields.days} />
      </fieldset>
      <div className="field-row">
        {text("start", "Opens", start, setStart, "09:00")}
        {text("end", "Closes", end, setEnd, "12:00")}
      </div>
      {text("label", "Label", label, setLabel)}
    </Dialog>
  );
}

interface FreezeDraft { name: string; starts: string; ends: string; stages: string[] }

function FreezeDialog({ slug, stages, basedOn, onClose, onDone }: {
  slug: string; stages: string[]; basedOn: number; onClose: () => void; onDone: () => Promise<void>;
}) {
  const say = useFeedback();
  const id = useId();
  const [effective, setEffective] = useState("");
  const [freezes, setFreezes] = useState<FreezeDraft[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const change = (index: number, patch: Partial<FreezeDraft>) => setFreezes(freezes.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const schedule = async () => {
    if (busy) return;
    const effectiveFrom = utcInstant(effective);
    const rows = freezes.map((f) => ({ name: f.name, stages: f.stages, starts_at: utcInstant(f.starts), ends_at: utcInstant(f.ends) }));
    const local: Record<string, string> = {};
    if (!effectiveFrom) local.effective_from = "Use YYYY-MM-DD HH:mm in UTC.";
    if (rows.some((r) => !r.starts_at || !r.ends_at)) local.freezes = "Use YYYY-MM-DD HH:mm in UTC for starts and ends.";
    if (Object.keys(local).length) {
      setFields(local);
      say(problem(Object.values(local).join(" ")));
      return;
    }
    setBusy(true);
    setError("");
    say(activity("Scheduling…"));
    const result = await call<FreezeVersion>("POST", `/api/projects/${slug}/freeze-policy/versions`,
      { body: { based_on_version: basedOn, effective_from: effectiveFrom, freezes: rows } });
    if (result.ok) {
      await onDone();
      say(activity(`Freeze policy version ${result.data.version} takes effect at ${clusterTime(result.data.effective_from, "UTC")}.`));
      return;
    }
    setBusy(false);
    if (result.error?.error === "stale_version") {
      const text = `Someone scheduled version ${result.error.current_version ?? ""} first. Reload to see it, then try again.`;
      setError(text);
      say(problem(text));
    } else {
      setFields(errorFields(result));
      say(problem(result.error?.error === "validation" ? Object.values(result.error.fields ?? {}).join(" ") : generalError(result)));
    }
  };
  return (
    <Dialog title="New freeze policy version" onClose={onClose} onSubmit={() => void schedule()}
      actions={<>
        <button type="button" className="button" onClick={() => setFreezes([...freezes, { name: "", starts: "", ends: "", stages: [] }])}>Add freeze</button>
        <button type="submit" className="button primary" disabled={busy}>Schedule version</button>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
      </>}>
      <p className="dialog-lead">{`Based on version ${basedOn}. The new version replaces every freeze.`}</p>
      <div className="field">
        <label className="field-inner">
        <span className="field-label">Effective from (UTC)</span>
        <input type="text" value={effective} placeholder="YYYY-MM-DD HH:mm UTC" onChange={(event) => setEffective(event.target.value)}
          aria-describedby={`${id}-effective`} aria-invalid={fields.effective_from ? true : undefined} />
      </label>
        <FieldError id={`${id}-effective`} message={fields.effective_from} />
      </div>
      {freezes.map((f, index) => (
        <fieldset key={index} className="freeze-row">
          <legend className="field-label">{`Freeze ${index + 1}`}</legend>
          <label className="field">
            <span className="field-label">Freeze name</span>
            <input type="text" value={f.name} onChange={(event) => change(index, { name: event.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Starts (UTC)</span>
              <input type="text" value={f.starts} placeholder="YYYY-MM-DD HH:mm UTC" onChange={(event) => change(index, { starts: event.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Ends (UTC)</span>
              <input type="text" value={f.ends} placeholder="YYYY-MM-DD HH:mm UTC" onChange={(event) => change(index, { ends: event.target.value })} />
            </label>
          </div>
          <div className="day-boxes">
            {stages.map((stage) => (
              <label key={stage} className="check">
                <input type="checkbox" checked={f.stages.includes(stage)}
                  onChange={(event) => change(index, { stages: event.target.checked ? [...f.stages, stage] : f.stages.filter((s) => s !== stage) })} />
                <span>{stage}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <FieldError id={`${id}-freezes`} message={fields.freezes} />
      {error && <p className="dialog-error">{error}</p>}
    </Dialog>
  );
}

function CheckInstant({ slug, clusters }: { slug: string; clusters: Cluster[] }) {
  const say = useFeedback();
  const id = useId();
  const stages = clusters.flatMap((c) => c.stages.map((stage) => ({ stage, zone: c.time_zone })));
  const [stage, setStage] = useState("");
  const [local, setLocal] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [fieldError, setFieldError] = useState("");
  const chosen = stages.find((s) => s.stage === stage) ?? stages[0];
  const check = async (event: FormEvent) => {
    event.preventDefault();
    const match = LOCAL.exec(local.trim());
    if (!chosen || !match) {
      setFieldError("Use YYYY-MM-DD HH:mm in the cluster's time.");
      return;
    }
    setFieldError("");
    say(activity("Checking…"));
    const at = new Date(localToInstant(match[1] as string, match[2] as string, chosen.zone)).toISOString();
    const result = await call<WindowDecision>("GET", `/api/projects/${slug}/stages/${encodeURIComponent(chosen.stage)}/window-decision?at=${encodeURIComponent(at)}`);
    if (!result.ok) {
      say(problem(generalError(result)));
      return;
    }
    const d = result.data;
    say(activity(""));
    setDecisionText(verdict(d, "this cluster has no sync windows"));
  };
  return (
    <form aria-label="Check an instant" className="panel check-form" onSubmit={(event) => void check(event)} noValidate>
      <h2 className="section-title">Check an instant</h2>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Stage</span>
          <span className="select-wrap">
            <select value={chosen?.stage ?? ""} onChange={(event) => setStage(event.target.value)}>
              {stages.map((s) => <option key={s.stage} value={s.stage}>{s.stage}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={16} />
          </span>
        </label>
        <div className="field">
          <label className="field-inner">
          <span className="field-label">Cluster local time</span>
          <input type="text" value={local} placeholder="YYYY-MM-DD HH:mm" onChange={(event) => setLocal(event.target.value)}
            aria-describedby={`${id}-local`} aria-invalid={fieldError ? true : undefined} />
        </label>
          <FieldError id={`${id}-local`} message={fieldError} />
        </div>
        <button type="submit" className="button primary">Check</button>
      </div>
      <p className="field-hint">{chosen ? `Judged in ${chosen.zone}.` : ""}</p>
      <output role="status" aria-label="Window decision" className="verdict mono">{decisionText}</output>
    </form>
  );
}

export function Windows({ session, slug }: { session: SessionBody; slug: string }) {
  const say = useFeedback();
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [openings, setOpenings] = useState<Record<string, Opening[]>>({});
  const [policy, setPolicy] = useState<FreezePolicy | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState<Cluster | null>(null);
  const [freezing, setFreezing] = useState<number | null>(null);
  const editor = session.memberships.some((m) => m.project === slug && m.role === "platform_engineer");

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      call<{ clusters: Cluster[] }>("GET", `/api/projects/${slug}/clusters`),
      call<FreezePolicy>("GET", `/api/projects/${slug}/freeze-policy`),
    ]);
    if (p.ok) setPolicy(p.data);
    if (!c.ok) return;
    setClusters(c.data.clusters);
    const listed = await Promise.all(c.data.clusters.map((cluster) =>
      call<{ openings: Opening[] }>("GET", `/api/projects/${slug}/clusters/${cluster.name}/window-openings?count=5`)));
    setOpenings(Object.fromEntries(c.data.clusters.map((cluster, i) => {
      const result = listed[i];
      return [cluster.name, result?.ok ? result.data.openings : []];
    })));
  }, [slug]);

  useEffect(() => void load(), [load]);
  useEvery(30_000, () => setNow(Date.now()));

  const remove = async (cluster: Cluster, window: SyncWindow) => {
    say(activity("Removing window…"));
    const result = await call("DELETE", `/api/projects/${slug}/clusters/${cluster.name}/windows/${window.id}`);
    await load();
    if (result.ok) say(activity("Window removed."));
    else say(problem(generalError(result)));
  };

  const stageNames = clusters?.flatMap((c) => c.stages) ?? [];
  const latest = policy ? Math.max(...policy.versions.map((v) => v.version)) : 0;

  return (
    <Shell session={session} slug={slug} stages={stageNames} title="Windows and freezes">
      {!clusters ? <p className="loading">Loading…</p> : (
        <div className="windows">
          <div className="cluster-grid">
            {clusters.map((cluster) => (
              <section key={cluster.name} aria-label={`Cluster ${cluster.name}`} className="panel cluster">
                <header className="cluster-head">
                  <h2 className="section-title">{cluster.name}</h2>
                  <p className="muted">{`${cluster.time_zone} · ${cluster.stages.join(", ")}`}</p>
                  <p className="mono">{`Cluster time ${clusterTime(now, cluster.time_zone)}`}</p>
                </header>
                <table aria-label={`Sync windows ${cluster.name}`} className="windows-table">
                  <thead><tr><th scope="col">Days</th><th scope="col">Opens</th><th scope="col">Closes</th><th scope="col">Label</th>{editor && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                  <tbody>
                    {cluster.windows.length === 0 && <tr><td colSpan={editor ? 5 : 4} className="muted">No sync windows: promotions may start at any time.</td></tr>}
                    {cluster.windows.map((w) => (
                      <tr key={w.id}>
                        <td data-label="Days">{w.days.map((d) => DAY_BOXES.find((x) => x.key === d)?.label).join(" ")}</td>
                        <td className="mono" data-label="Opens">{w.start}</td>
                        <td className="mono" data-label="Closes">{w.end}</td>
                        <td data-label="Label">{w.label}</td>
                        {editor && <td><button type="button" className="button quiet" onClick={() => void remove(cluster, w)}>
                          <span className="sr-only">{`Delete window ${w.label}`}</span><span aria-hidden="true">Delete</span>
                        </button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="subsection-title">Next openings</h3>
                <ul aria-label={`Next openings ${cluster.name}`} className="openings mono">
                  {(openings[cluster.name] ?? []).map((o) => <li key={o.opens_at + o.window_id}>{`${o.local_opens} ${cluster.time_zone}`}<span className="muted">{` ${o.label}`}</span></li>)}
                  {(openings[cluster.name] ?? []).length === 0 && <li className="muted">No openings scheduled.</li>}
                </ul>
                {editor && <button type="button" className="button" onClick={() => setAdding(cluster)}>Add window</button>}
              </section>
            ))}
          </div>
          <CheckInstant slug={slug} clusters={clusters} />
          <section aria-label="Freeze policy" className="panel freeze-policy">
            <h2 className="section-title">Freeze policy</h2>
            <ol className="versions">
              {[...(policy?.versions ?? [])].reverse().map((v) => (
                <li key={v.version} className={v.version === policy?.in_force_version ? "is-in-force" : ""}>
                  <p className="version-head">
                    <span className="mono">{`Version ${v.version}`}</span>
                    {v.version === policy?.in_force_version && <span className="badge">In force now</span>}
                    {v.version > (policy?.in_force_version ?? 0) && <span className="badge muted">Scheduled</span>}
                  </p>
                  <p className="mono">{`Effective from ${clusterTime(v.effective_from, "UTC")}`}<span className="muted">{` · ${v.created_by}`}</span></p>
                  {v.freezes.length === 0 ? <p className="muted">No freezes.</p> : (
                    <ul className="freezes">
                      {v.freezes.map((f) => (
                        <li key={f.name}>{`${f.name}: ${f.stages.join(", ")}, ${clusterTime(f.starts_at, "UTC")} to ${clusterTime(f.ends_at, "UTC")}`}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {editor && <button type="button" className="button" onClick={() => setFreezing(latest)}>New freeze version</button>}
          </section>
        </div>
      )}
      {adding && <AddWindowDialog slug={slug} cluster={adding} onClose={() => setAdding(null)} onDone={async () => { await load(); setAdding(null); }} />}
      {freezing !== null && <FreezeDialog slug={slug} stages={stageNames} basedOn={freezing} onClose={() => setFreezing(null)}
        onDone={async () => { await load(); setFreezing(null); }} />}
    </Shell>
  );
}
