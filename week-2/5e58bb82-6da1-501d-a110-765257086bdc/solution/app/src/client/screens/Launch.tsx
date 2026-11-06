// The launch list: honest afloat/recovered rows, line-file uploads (held through storage outages and
// finished after a session ends), mark complete, thruster service, and actions queued while offline.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, idempotencyKey, NoResponse, Stale, type Line, type MissionSummary, type User, type Vessel } from "../api";
import { Dialog } from "../components/Dialog";
import { usePoll } from "../hooks";
import { onStatus, storageReportedDown } from "../services";
import { useSession } from "../session";
import { heldUpload, onHeldChange, readQueue, sendLineFile, setHeld, writeQueue, type Held, type Queued, type QueuedAction } from "../slipway";
import { hours, interval } from "../units";

const OPEN = new Set(["Planned", "Launched", "Surveying", "Recovering"]);
const ACTION_WORD: Record<QueuedAction, string> = { afloat: "afloat", recovered: "recovered", service: "service" };

interface Section {
  mission: MissionSummary;
  lines: Line[];
}

type Busy = { kind: "vessel"; id: string } | { kind: "complete"; id: string } | null;

export function Launch() {
  const { user } = useSession();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [completed, setCompleted] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [uploadFor, setUploadFor] = useState<{ line: Line; missionId: string } | null>(null);
  const [serviceFor, setServiceFor] = useState<Vessel | null>(null);
  const [queue, setQueue] = useState<Queued[]>(() => readQueue(user.id));
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [waitingOpen, setWaitingOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<string | null>(null);
  const held = useSyncExternalStore(onHeldChange, heldUpload);

  const load = usePoll(async () => {
    const [m, v] = await Promise.all([api<MissionSummary[]>("/api/missions"), api<Vessel[]>("/api/vessels")]);
    if (!m.ok || !v.ok) return;
    setVessels(v.data);
    const now = Date.now();
    const keep = (x: MissionSummary) => OPEN.has(x.status) || (completed[x.id] !== undefined && completed[x.id] > now);
    const open = m.data.filter(keep).sort((a, b) => a.survey_date.localeCompare(b.survey_date) || a.name.localeCompare(b.name));
    const found: Section[] = [];
    for (const mission of open) {
      const l = await api<Line[]>(`/api/missions/${mission.id}/lines`);
      if (l.ok) found.push({ mission: completed[mission.id] ? { ...mission, status: "Complete" } : mission, lines: l.data });
    }
    setSections(found);
  }, 2000, [completed]);

  useLayoutEffect(() => {
    if (!focusAfter.current || !sections) return;
    const target = focusAfter.current === "list" ? heading.current : document.getElementById(`section-${focusAfter.current}`);
    focusAfter.current = null;
    target?.focus();
  });

  const vesselById = (id: string) => vessels.find((v) => v.id === id);

  // --- live and queued slipway actions ---

  const send = useCallback(async (item: Queued): Promise<"done" | "refused" | "unreachable"> => {
    const path = item.action === "service" ? `/api/vessels/${item.vesselId}/services` : `/api/vessels/${item.vesselId}/${item.action}`;
    const r = await api<Vessel>(path, { method: "POST", body: item.action === "service" ? { note: item.note } : {}, headers: { "Idempotency-Key": item.key } });
    if (r.ok) {
      if (item.action === "service") setStatus(`Service logged for ${item.vesselName}`);
      else setStatus(item.action === "afloat" ? `${item.vesselName} is afloat` : `${item.vesselName} is recovered`);
      if (item.action !== "service") setVessels((vs) => vs.map((v) => (v.id === r.data.id ? r.data : v)));
      return "done";
    }
    const message = r.error?.message ?? "Refused";
    setNotices((n) => ({ ...n, [`${item.vesselId}:${item.action === "service" ? "service" : "slip"}`]: `Not sent — ${message}` }));
    setStatus(message);
    return "refused";
  }, []);

  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      let items = readQueue(user.id);
      while (items.length) {
        const [item, ...rest] = items;
        let outcome: "done" | "refused" | "unreachable";
        try {
          outcome = await send(item);
        } catch (e) {
          if (e instanceof Stale) return;
          if (!(e instanceof NoResponse)) throw e;
          outcome = "unreachable";
        }
        if (outcome === "unreachable") break;
        items = rest;
        if (outcome === "refused") {
          const dropped = items.filter((x) => x.vesselId === item.vesselId);
          items = items.filter((x) => x.vesselId !== item.vesselId);
          for (const x of dropped) {
            setNotices((n) => ({ ...n, [`${x.vesselId}:${x.action === "service" ? "service" : "slip"}`]: `Not sent — an earlier action for ${x.vesselName} was refused` }));
          }
        } else setNotices((n) => {
          const next = { ...n };
          delete next[`${item.vesselId}:${item.action === "service" ? "service" : "slip"}`];
          return next;
        });
        writeQueue(user.id, items);
        setQueue(items);
      }
      load();
    } finally {
      flushing.current = false;
    }
  }, [load, send, user.id]);

  useEffect(() => {
    window.addEventListener("online", flush);
    if (readQueue(user.id).length) void flush();
    return () => window.removeEventListener("online", flush);
  }, [flush, user.id]);

  const enqueue = (vessel: Vessel, action: QueuedAction, key = idempotencyKey(), note?: string) => {
    const items = [...readQueue(user.id), { id: idempotencyKey(), vesselId: vessel.id, vesselName: vessel.name, action, key, note, at: Date.now() }];
    writeQueue(user.id, items);
    setQueue(items);
    setStatus(`Saved on this phone — ${items.length} waiting to send`);
  };

  const mark = async (vessel: Vessel) => {
    const action: QueuedAction = vessel.afloat ? "recovered" : "afloat";
    if (!navigator.onLine) return enqueue(vessel, action);
    if (busy) return;
    setBusy({ kind: "vessel", id: vessel.id });
    setStatus(vessel.afloat ? `Marking ${vessel.name} recovered` : `Marking ${vessel.name} afloat`);
    try {
      await send({ id: "", vesselId: vessel.id, vesselName: vessel.name, action, key: idempotencyKey(), at: Date.now() });
    } catch (e) {
      if (e instanceof NoResponse) setStatus(`Could not reach Swathdeck — ${vessel.name} is still ${vessel.afloat ? "afloat" : "ashore"}`);
      else if (!(e instanceof Stale)) throw e;
    } finally {
      setBusy(null);
    }
  };

  const complete = async (mission: MissionSummary) => {
    if (busy) return;
    setBusy({ kind: "complete", id: mission.id });
    setStatus("Completing mission");
    try {
      const r = await api(`/api/missions/${mission.id}/transitions`, { method: "POST", body: { to: "Complete" } });
      if (!r.ok) {
        setStatus(r.error?.message ?? "Not complete");
        return;
      }
      setCompleted((c) => ({ ...c, [mission.id]: Date.now() + 2000 }));
      const after = await api<MissionSummary[]>("/api/missions");
      const open = after.ok ? after.data.filter((x) => OPEN.has(x.status) && x.id !== mission.id).length : 0;
      setStatus(`${mission.name} complete — ${open} missions open`);
      const ids = (sections ?? []).filter((s) => OPEN.has(s.mission.status)).map((s) => s.mission.id);
      const here = ids.indexOf(mission.id);
      focusAfter.current = ids[here + 1] ?? ids.find((id) => id !== mission.id) ?? "list";
      setSections((list) => list && list.map((s) => (s.mission.id === mission.id ? { ...s, mission: { ...s.mission, status: "Complete" } } : s)));
    } catch (e) {
      if (e instanceof NoResponse) setStatus(`Could not reach Swathdeck — ${mission.name} is still recovering`);
      else if (!(e instanceof Stale)) throw e;
    } finally {
      setBusy(null);
    }
  };

  // Completed sections leave the list on the first refresh after two seconds.
  useEffect(() => {
    const ids = Object.keys(completed);
    if (!ids.length) return;
    const timer = window.setTimeout(() => {
      setCompleted((c) => Object.fromEntries(Object.entries(c).filter(([, until]) => until > Date.now())));
    }, Math.max(0, Math.min(...Object.values(completed)) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [completed]);

  // --- uploads ---

  const runUpload = useCallback(async (job: Held, report: (state: "sent" | "held" | "unreachable" | "session" | "refused", detail?: Record<string, string>) => void) => {
    setProgress((p) => ({ ...p, [job.lineId]: "Uploading 0%" }));
    setStatus(`Uploading ${job.label}`);
    try {
      const r = await sendLineFile(job.lineId, job.file, job.sha, (n) => setProgress((p) => ({ ...p, [job.lineId]: `Uploading ${n}%` })));
      setProgress((p) => {
        const next = { ...p };
        delete next[job.lineId];
        return next;
      });
      if (r.status === 200 || r.status === 201) {
        setStatus(`${job.label} stored`);
        load();
        report("sent");
      } else if (r.status === 503) {
        storageReportedDown();
        setStatus(`Storage is unreachable — ${job.label} is still awaiting upload`);
        report("held");
      } else if (r.status === 401) report("session");
      else if (r.status === 413) {
        setStatus(`${job.label} file is over 50,000,000 bytes`);
        report("refused");
      } else {
        if (r.body?.message && !r.body.errors) setStatus(r.body.message);
        report("refused", r.body?.errors);
      }
    } catch (e) {
      setProgress((p) => {
        const next = { ...p };
        delete next[job.lineId];
        return next;
      });
      if (e instanceof NoResponse) {
        setStatus(`Could not reach Swathdeck — ${job.label} is not uploaded yet`);
        report("unreachable");
      } else if (!(e instanceof Stale)) throw e;
    }
  }, [load]);

  // A held upload sends itself once when storage is reported up again.
  useEffect(() => onStatus((next, previous) => {
    const job = heldUpload();
    if (!job || next.storage !== "up" || previous?.storage !== "down") return;
    setHeld(null);
    void runUpload(job, (state) => {
      if (state === "held") setHeld(job);
    });
  }), [runUpload]);

  if (!sections) return <main className="page narrow"><h1 ref={heading} tabIndex={-1}>Launch list</h1><p className="muted">Loading launch list…</p></main>;

  const fileText = (l: Line) => progress[l.id] ?? (held?.lineId === l.id ? "Waiting for storage" : l.file?.state ?? "");

  return (
    <main className="page narrow">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 ref={heading} tabIndex={-1}>Launch list</h1>
        {queue.length > 0 && <button type="button" onClick={() => setWaitingOpen(true)}>Waiting to send ({queue.length})</button>}
      </div>
      <p role="status" aria-live="polite" aria-label="Launch status">{status}</p>
      {!sections.length && <p className="muted">No open missions.</p>}
      {sections.map(({ mission, lines }) => {
        const vesselIds = [...new Set(lines.map((l) => l.vessel_id).filter((v): v is string => !!v))];
        const rows = vessels.filter((v) => vesselIds.includes(v.id));
        const finished = lines.filter((l) => l.status === "Surveyed" || l.status === "Delivered");
        return (
          <section key={mission.id} className="launch-section" aria-labelledby={`section-${mission.id}`}>
            <div>
              <h2 id={`section-${mission.id}`} tabIndex={-1}>{mission.name}</h2>
              <p className="row"><span className="muted">{mission.client_name}</span><span className="status-word">{mission.status}</span></p>
            </div>
            <ul className="slip-rows" aria-label={`Vessels on ${mission.name}`}>
              {rows.map((v) => {
                const pendingHere = busy?.kind === "vessel" && busy.id === v.id;
                const queued = queue.some((q) => q.vesselId === v.id && q.action !== "service");
                const notice = queued ? "Queued — will send when online" : notices[`${v.id}:slip`];
                return (
                  <li key={v.id}>
                    <div className="who">
                      <strong>{v.name}</strong>
                      <span><span className="state-word">{v.afloat ? "Afloat" : "Ashore"}</span> · {v.link_state} · <span className="num">{hours(v.hours_since_service)}</span> since service</span>
                      {notice && <span className="notice">{notice}</span>}
                    </div>
                    <button type="button" aria-disabled={pendingHere || undefined} aria-label={pendingHere ? "Marking…" : `Mark ${v.name} ${v.afloat ? "recovered" : "afloat"}`}
                      onClick={() => void mark(v)}>
                      {pendingHere ? "Marking…" : `Mark ${v.name} ${v.afloat ? "recovered" : "afloat"}`}
                    </button>
                  </li>
                );
              })}
            </ul>
            {finished.length > 0 && (
              <ul className="slip-rows" aria-label={`Line files for ${mission.name}`}>
                {finished.map((l) => (
                  <li key={l.id}>
                    <div className="who"><strong>{l.label}</strong><span>{fileText(l)}</span></div>
                    {l.file?.state === "Awaiting upload" && (
                      <button type="button" aria-label={`Upload file for ${l.label}`} aria-disabled={progress[l.id] ? true : undefined}
                        onClick={() => !progress[l.id] && setUploadFor({ line: l, missionId: mission.id })}>Upload file</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {mission.status === "Recovering" && (
              <button type="button" className="primary" aria-disabled={(busy?.kind === "complete" && busy.id === mission.id) || undefined} onClick={() => void complete(mission)}>
                {busy?.kind === "complete" && busy.id === mission.id ? "Completing…" : "Mark mission complete"}
              </button>
            )}
          </section>
        );
      })}
      <section className="launch-section" aria-labelledby="service-heading">
        <h2 id="service-heading">Fleet service</h2>
        <ul className="slip-rows">
          {vessels.map((v) => (
            <li key={v.id}>
              <div className="who">
                <strong>{v.name}</strong>
                <span><span className="num">{hours(v.thruster_hours_total)}</span> total · <span className="num">{hours(v.hours_since_service)}</span> of <span className="num">{interval(v.service_interval_h)}</span> since service</span>
                {v.service_overdue && <span className="overdue-note">Service overdue</span>}
                {queue.some((q) => q.vesselId === v.id && q.action === "service")
                  ? <span className="notice">Queued — will send when online</span>
                  : notices[`${v.id}:service`] && <span className="notice">{notices[`${v.id}:service`]}</span>}
              </div>
              <button type="button" aria-label={`Log service for ${v.name}`} onClick={() => setServiceFor(v)}>Log service</button>
            </li>
          ))}
        </ul>
      </section>
      {uploadFor && (
        <UploadDialog key={uploadFor.line.id} line={uploadFor.line} missionId={uploadFor.missionId} user={user}
          onClose={() => setUploadFor(null)} run={runUpload} />
      )}
      {serviceFor && (
        <ServiceDialog vessel={vesselById(serviceFor.id) ?? serviceFor} onClose={() => setServiceFor(null)}
          onQueue={(key, note) => {
            enqueue(serviceFor, "service", key, note);
            setServiceFor(null);
          }}
          onLogged={() => {
            setStatus(`Service logged for ${serviceFor.name}`);
            setServiceFor(null);
            load();
          }}
          setStatus={setStatus} />
      )}
      {waitingOpen && (
        <Dialog label="Waiting to send" onClose={() => setWaitingOpen(false)}>
          <h2>Waiting to send</h2>
          <ol className="slip-rows">
            {queue.map((q) => (
              <li key={q.id}>
                <span>{q.vesselName} · {ACTION_WORD[q.action]} · <span className="num">{new Date(q.at).toISOString().slice(11, 16)}</span> UTC</span>
                <button type="button" aria-label={`Discard ${q.vesselName} ${ACTION_WORD[q.action]}`} onClick={() => {
                  const items = readQueue(user.id).filter((x) => x.id !== q.id);
                  writeQueue(user.id, items);
                  setQueue(items);
                  setNotices((n) => {
                    const next = { ...n };
                    delete next[`${q.vesselId}:${q.action === "service" ? "service" : "slip"}`];
                    return next;
                  });
                  if (!items.length) setWaitingOpen(false);
                  else document.querySelector<HTMLElement>(".waiting-close")?.focus();
                }}>Discard</button>
              </li>
            ))}
          </ol>
          <div className="actions"><button type="button" className="waiting-close" onClick={() => setWaitingOpen(false)}>Close</button></div>
        </Dialog>
      )}
    </main>
  );
}

type UploadState = "form" | "sending" | "retry" | "session" | "held";

interface UploadProps {
  line: Line;
  missionId: string;
  user: User;
  onClose: () => void;
  run: (job: Held, report: (state: "sent" | "held" | "unreachable" | "session" | "refused", detail?: Record<string, string>) => void) => Promise<void>;
}

function UploadDialog({ line, missionId, user, onClose, run }: UploadProps) {
  const { switchTo } = useSession();
  const existing = heldUpload()?.lineId === line.id ? heldUpload() : null;
  const [file, setFile] = useState<File | null>(existing?.file ?? null);
  const [sha, setSha] = useState(existing?.sha ?? "");
  const [state, setState] = useState<UploadState>(existing ? "held" : "form");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signInError, setSignInError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (existing?.file && fileInput.current) {
      const transfer = new DataTransfer();
      transfer.items.add(existing.file);
      fileInput.current.files = transfer.files;
    }
  }, []);

  const job = (): Held | null => (file ? { lineId: line.id, label: line.label, missionId, file, sha: sha.trim() } : null);

  const upload = async () => {
    const j = job();
    if (!j) {
      setErrors({ file: "Choose the line file from the logger" });
      return;
    }
    setErrors({});
    setState("sending");
    await run(j, (outcome, detail) => {
      if (outcome === "sent") onClose();
      else if (outcome === "held") {
        setHeld(j);
        setState("held");
      } else if (outcome === "unreachable") setState("retry");
      else if (outcome === "session") setState("session");
      else {
        setErrors(detail ?? {});
        setState("form");
      }
    });
  };

  const cancel = () => {
    if (heldUpload()?.lineId === line.id) setHeld(null);
    onClose();
  };

  const signIn = async (form: FormData) => {
    setSignInError(null);
    try {
      const r = await api<{ user: User; home: string }>("/api/session", { method: "POST", own401: true, body: { email: form.get("email"), password: form.get("password") } });
      if (!r.ok) {
        setSignInError(r.status === 429 ? r.error?.message ?? null : "Email or password is incorrect.");
        return;
      }
      if (r.data.user.id !== user.id) {
        onClose();
        switchTo(r.data.user, r.data.home);
        return;
      }
      await upload();
    } catch (e) {
      if (e instanceof NoResponse) setSignInError("Could not reach Swathdeck — try again in a moment.");
      else if (!(e instanceof Stale)) throw e;
    }
  };

  return (
    <Dialog label="Upload line file" onClose={state === "held" ? onClose : cancel} onEscape={state === "held" ? onClose : cancel}>
      <h2>Upload line file</h2>
      <p className="muted">{line.label}</p>
      <div className="field">
        <label htmlFor="line-file">Line file</label>
        <input ref={fileInput} id="line-file" type="file" disabled={state === "held" || state === "sending"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {(errors.file || errors.file_name) && <p className="field-error">{errors.file ?? errors.file_name}</p>}
      </div>
      <div className="field">
        <label htmlFor="sha">SHA-256</label>
        <input id="sha" type="text" className="num" spellCheck={false} autoComplete="off" value={sha} disabled={state === "held" || state === "sending"} onChange={(e) => setSha(e.target.value)} />
        {errors.sha256 && <p className="field-error">{errors.sha256}</p>}
      </div>
      {state === "held" && <p>Waiting for storage — {line.label} will upload when it returns</p>}
      {state === "session" && (
        <form className="field" onSubmit={(e) => {
          e.preventDefault();
          void signIn(new FormData(e.currentTarget));
        }}>
          <p>Your session ended — sign in again to finish uploading {line.label}</p>
          <label htmlFor="up-email">Email</label>
          <input id="up-email" name="email" type="email" autoComplete="username" />
          <label htmlFor="up-password">Password</label>
          <input id="up-password" name="password" type="password" autoComplete="current-password" />
          {signInError && <p className="field-error">{signInError}</p>}
          <button type="submit" className="primary">Sign in and upload</button>
        </form>
      )}
      <div className="actions">
        {state === "form" && <button type="button" className="primary" onClick={() => void upload()}>Upload</button>}
        {state === "sending" && <button type="button" className="primary" disabled>Uploading…</button>}
        {state === "retry" && <button type="button" className="primary" onClick={() => void upload()}>Retry upload</button>}
        {state === "held" && <button type="button" onClick={onClose}>Hide</button>}
        <button type="button" onClick={cancel}>Cancel</button>
      </div>
    </Dialog>
  );
}

interface ServiceProps {
  vessel: Vessel;
  onClose: () => void;
  onQueue: (key: string, note: string) => void;
  onLogged: () => void;
  setStatus: (text: string) => void;
}

function ServiceDialog({ vessel, onClose, onQueue, onLogged, setStatus }: ServiceProps) {
  const key = useRef(idempotencyKey());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!navigator.onLine) return onQueue(key.current, note);
    setStatus("Logging service");
    try {
      const r = await api(`/api/vessels/${vessel.id}/services`, { method: "POST", body: { note }, headers: { "Idempotency-Key": key.current } });
      if (r.status === 201) onLogged();
      else {
        setError(r.error?.errors?.note ?? r.error?.message ?? null);
        setStatus(r.error?.errors?.note ?? r.error?.message ?? "");
      }
    } catch (e) {
      if (e instanceof NoResponse) setStatus(`Could not reach Swathdeck — service for ${vessel.name} is not logged yet`);
      else if (!(e instanceof Stale)) throw e;
    }
  };
  return (
    <Dialog label="Log thruster service" onClose={onClose}>
      <h2>Log thruster service</h2>
      <p>{vessel.name} · <span className="num">{hours(vessel.hours_since_service)}</span> since service</p>
      <div className="field">
        <label htmlFor="service-note">Service note</label>
        <textarea id="service-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void save()}>Save service</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
