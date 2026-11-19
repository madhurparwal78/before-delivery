// The defect editor: edit locks, saving, stills, repairs, history and deletion. One instance is one editing session.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, Unreachable, del, get, patch, post, upload, type Defect, type DefectType, type Pen, type Still } from "./api";
import type { WallPoint } from "./engine/twin";
import { METHOD_LABEL, TYPE_LABEL, graphemeCount } from "./format";
import { Confirm, ErrorLine } from "./ui";

const NOTE_LIMIT = 500;
const NOTE_TOO_LONG = "Note is longer than 500 characters";
const SIZE_FIELDS: Record<DefectType, [string, string][]> = {
  hole: [["width_cm", "Width (cm)"], ["height_cm", "Height (cm)"]],
  tear: [["length_cm", "Length (cm)"], ["gap_cm", "Gap (cm)"]],
  chafe: [["length_cm", "Length (cm)"], ["width_cm", "Width (cm)"]],
  fouling: [["width_m", "Width (m)"], ["height_m", "Height (m)"]],
};

let lockQueue: Promise<unknown> = Promise.resolve();
const queued = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = lockQueue.then(job, job);
  lockQueue = run.then(() => undefined, () => undefined);
  return run;
};

const decimals = (type: DefectType, key: string, value: number) => (type === "fouling" && key.endsWith("_m") ? value.toFixed(1) : String(value));
const number = (text: string): number | string | null => (text.trim() === "" ? null : Number.isNaN(Number(text)) ? text : Number(text));

interface HistoryEntry { at: string; device_name: string; action: string; changes: Record<string, { before: unknown; after: unknown }> }
const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const time = (iso: string) => `${iso.slice(11, 16)} UTC`;

interface EditorProps {
  mode: "edit" | "new";
  defect?: Defect;
  wallPoint?: WallPoint;
  pen: Pen;
  closing: boolean;
  historyTick: number;
  onPen: (pen: Pen) => void;
  onCreated: (defect: Defect) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function Editor({ mode, defect, wallPoint, pen, closing, historyTick, onPen, onCreated, onClose, onDeleted }: EditorProps) {
  const [current, setCurrent] = useState<Defect | undefined>(defect);
  const [type, setType] = useState<DefectType>(defect?.type ?? "hole");
  const [bearing, setBearing] = useState(defect ? defect.bearing_deg.toFixed(1) : "");
  const [depth, setDepth] = useState(defect ? defect.depth_m.toFixed(1) : "");
  const [sizes, setSizes] = useState<Record<string, string>>(
    defect ? Object.fromEntries(Object.entries(defect.size).map(([k, v]) => [k, decimals(defect.type, k, v)])) : {},
  );
  const [note, setNote] = useState(defect?.note ?? "");
  const [privateNote, setPrivateNote] = useState(defect?.private_note ?? "");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lockedBy, setLockedBy] = useState("");
  const [method, setMethod] = useState("patch");
  const [repairNote, setRepairNote] = useState("");
  const [repairErrors, setRepairErrors] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const restoreOnClose = useRef(true);
  const held = useRef(false);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const id = current?.id;

  useEffect(() => { heading.current?.focus(); }, []);

  // ---- the edit lock: taken on open, refreshed every 10 s while open, released on close
  const release = () => {
    if (!held.current || !id) return;
    held.current = false;
    void queued(() => del(`/api/defects/${id}/lock`)).catch(() => undefined);
  };
  useEffect(() => {
    if (!id) return;
    alive.current = true;
    void queued(() => post(`/api/defects/${id}/lock`, undefined, { silent: true }))
      .then(() => {
        if (!alive.current) {
          void queued(() => del(`/api/defects/${id}/lock`)).catch(() => undefined);
          return;
        }
        held.current = true;
      })
      .catch((error) => {
        if (error instanceof ApiFailure && alive.current) {
          if (error.code === "locked") setLockedBy(error.message);
          else setStatus(error.message);
        }
      });
    const timer = window.setInterval(() => {
      if (!held.current) return;
      void queued(() => post(`/api/defects/${id}/lock`, undefined, { silent: true })).catch((error) => {
        if (error instanceof ApiFailure && alive.current) {
          held.current = false;
          setStatus("Your edit lock expired — reopen the editor to continue");
        }
      });
    }, 10000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      if (held.current) {
        held.current = false;
        void queued(() => del(`/api/defects/${id}/lock`)).catch(() => undefined);
      }
    };
  }, [id]);
  useEffect(() => { if (closing) release(); });

  // ---- history: loaded on open and again after this session's own writes or another device's change
  const [writes, setWrites] = useState(0);
  const refreshHistory = () => setWrites((n) => n + 1);
  useEffect(() => {
    if (!id) return;
    let live = true;
    get<{ history: HistoryEntry[] }>(`/api/defects/${id}/history`, { silent: true }).then((reply) => { if (live) setHistory(reply.history); }, () => undefined);
    return () => { live = false; };
  }, [id, historyTick, writes]);

  const kind: DefectType = current?.type ?? type;
  const readOnly = lockedBy !== "";
  const adopt = (saved: Defect) => {
    setCurrent(saved);
    setBearing(saved.bearing_deg.toFixed(1));
    setDepth(saved.depth_m.toFixed(1));
    setSizes(Object.fromEntries(Object.entries(saved.size).map(([k, v]) => [k, decimals(saved.type, k, v)])));
    setNote(saved.note);
    setPrivateNote(saved.private_note);
  };

  const fail = (error: unknown, into: (errors: Record<string, string>) => void) => {
    if (error instanceof Unreachable) {
      setStatus("");
    } else if (error instanceof ApiFailure) {
      if (error.status === 422 && error.fields) {
        into(error.fields);
        setStatus("");
      } else {
        if (error.code === "locked") setLockedBy(error.message);
        setStatus(error.message);
      }
    }
  };

  const sizeBody = () => Object.fromEntries(SIZE_FIELDS[kind].map(([key]) => [key, number(sizes[key] ?? "")]));

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy.current || readOnly) return;
    busy.current = true;
    setPending(true);
    setStatus("Saving…");
    setErrors({});
    try {
      if (current) {
        const reply = await patch<{ defect: Defect; pen: Pen }>(`/api/defects/${current.id}`, {
          version: current.version, bearing_deg: number(bearing), depth_m: number(depth), size: sizeBody(), note, private_note: privateNote,
        });
        adopt(reply.defect);
        onPen(reply.pen);
        setStatus(`Saved ${reply.defect.id}`);
        refreshHistory();
      } else {
        const typed = bearing.trim() !== "" || depth.trim() !== "";
        const position = typed || !wallPoint ? { bearing_deg: number(bearing), depth_m: number(depth) } : { wall_point: wallPoint };
        const reply = await post<{ defect: Defect; pen: Pen }>(`/api/pens/${pen.id}/defects`, { type, size: sizeBody(), note, private_note: privateNote, ...position });
        adopt(reply.defect);
        onPen(reply.pen);
        onCreated(reply.defect);
        setStatus(`Saved ${reply.defect.id}`);
      }
    } catch (error) {
      fail(error, setErrors);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file || !current || busy.current || readOnly) return;
    busy.current = true;
    setPending(true);
    setStatus("Uploading still…");
    try {
      const reply = await upload<{ still: Still }>(`/api/defects/${current.id}/stills`, file, "image/png");
      setCurrent((d) => (d ? { ...d, stills: [...d.stills, reply.still] } : d));
      setStatus(`Attached still ${reply.still.id}`);
      refreshHistory();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 413) setStatus("Still is larger than 8,000,000 bytes");
      else if (error instanceof ApiFailure && error.fields?.content_type) setStatus(error.fields.content_type);
      else fail(error, () => undefined);
    } finally {
      busy.current = false;
      setPending(false);
      if (files.current) files.current.value = "";
    }
  };

  const record = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || readOnly || !current) return;
    busy.current = true;
    setPending(true);
    setStatus("Recording repair…");
    setRepairErrors({});
    try {
      const reply = await post<{ defect: Defect; pen: Pen }>(`/api/defects/${current.id}/repairs`, { method, note: repairNote });
      setCurrent(reply.defect);
      onPen(reply.pen);
      setStatus(`Repair recorded for ${reply.defect.id}`);
      setRepairNote("");
      refreshHistory();
    } catch (error) {
      fail(error, setRepairErrors);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const remove = async () => {
    if (!current || deleting) return;
    setDeleting(true);
    setStatus("Removing…");
    try {
      const reply = await del<{ pen: Pen }>(`/api/defects/${current.id}`);
      held.current = false;
      restoreOnClose.current = false;
      setStatus(`Removed ${current.id}`);
      setConfirming(false);
      onPen(reply.pen);
      onDeleted(current.id);
    } catch (error) {
      setConfirming(false);
      fail(error, () => undefined);
    } finally {
      setDeleting(false);
    }
  };

  const noteError = (text: string) => (graphemeCount(text) > NOTE_LIMIT ? NOTE_TOO_LONG : "");
  const fieldError = (key: string) => errors[key] ?? "";
  const field = (label: string, key: string, value: string, set: (v: string) => void, extra?: string) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input type="text" inputMode="decimal" aria-label={label} value={value} readOnly={readOnly} onChange={(e) => set(e.target.value)} autoComplete="off" />
      {(fieldError(key) || extra) && <small className="field-error"><ErrorLine>{fieldError(key) || extra}</ErrorLine></small>}
    </label>
  );

  return (
    <section aria-label="Defect editor" className={closing ? "editor closing" : "editor"}>
      <div className="editor-head">
        <h2 ref={heading} tabIndex={-1}>{current ? `Edit ${current.id}` : "New defect"}</h2>
        <button type="button" className="btn" onClick={onClose}>Close editor</button>
      </div>
      {lockedBy && <p className="lock-line">{lockedBy}</p>}
      {!current && wallPoint && <p className="muted">From the net wall</p>}
      <form onSubmit={save} className="editor-form">
        {!current && (
          <label className="field">
            <span>Type</span>
            <select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value as DefectType); setSizes({}); }}>
              {(Object.keys(TYPE_LABEL) as DefectType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            {fieldError("type") && <small className="field-error"><ErrorLine>{fieldError("type")}</ErrorLine></small>}
          </label>
        )}
        {field("Bearing (°)", "bearing_deg", bearing, setBearing, fieldError("wall_point"))}
        {field("Depth (m)", "depth_m", depth, setDepth)}
        {SIZE_FIELDS[kind].map(([key, label]) => field(label, `size.${key}`, sizes[key] ?? "", (v) => setSizes((s) => ({ ...s, [key]: v }))))}
        <label className="field">
          <span>Note</span>
          <textarea aria-label="Note" rows={3} value={note} readOnly={readOnly} onChange={(e) => setNote(e.target.value)} />
          <small className="char-count num">{graphemeCount(note)} / {NOTE_LIMIT}</small>
          {(noteError(note) || fieldError("note")) && <small className="field-error"><ErrorLine>{noteError(note) || fieldError("note")}</ErrorLine></small>}
        </label>
        <label className="field">
          <span>Private note</span>
          <textarea aria-label="Private note" rows={2} value={privateNote} readOnly={readOnly} onChange={(e) => setPrivateNote(e.target.value)} />
          <small className="char-count num">{graphemeCount(privateNote)} / {NOTE_LIMIT}</small>
          {(noteError(privateNote) || fieldError("private_note")) && <small className="field-error"><ErrorLine>{noteError(privateNote) || fieldError("private_note")}</ErrorLine></small>}
        </label>
        <dl className="server-values num">
          <div><dt>Chart x</dt><dd>{current ? `${current.chart_x_m.toFixed(2)} m` : "—"}</dd></div>
          <div><dt>Chart y</dt><dd>{current ? `${current.chart_y_m.toFixed(1)} m` : "—"}</dd></div>
          <div><dt>Cell</dt><dd>{current ? current.cell : "—"}</dd></div>
          {kind === "fouling"
            ? <div><dt>Patch area</dt><dd>{current?.patch_area_m2 != null ? `${current.patch_area_m2.toFixed(1)} m²` : "—"}</dd></div>
            : <div><dt>Area</dt><dd>{current?.area_cm2 != null ? `${current.area_cm2} cm²` : "—"}</dd></div>}
        </dl>
        <div className="editor-actions">
          <button type="submit" className="btn btn-solid" disabled={readOnly || pending} aria-busy={pending}>Save</button>
          {current && <button type="button" className="btn" disabled={readOnly || pending} onClick={() => setConfirming(true)}>Delete defect</button>}
        </div>
      </form>
      {current && (
        <>
          <div className="editor-block">
            <button type="button" className="btn" disabled={readOnly || pending} onClick={() => files.current?.click()}>Attach still</button>
            <input ref={files} type="file" accept="image/jpeg,image/png" hidden tabIndex={-1} onChange={(e) => void attach(e.target.files?.[0])} />
            <ul role="list" aria-label="Stills" className="plain">
              {current.stills.map((s) => (
                <li key={s.id}><a href={`/api/stills/${s.id}/raw`} download={s.file_name} aria-label={`Download still ${s.id}`}>{s.id} · {s.file_name}</a></li>
              ))}
            </ul>
          </div>
          <form className="editor-block" onSubmit={record}>
            <label className="field">
              <span>Repair method</span>
              <select aria-label="Repair method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={readOnly}>
                {Object.entries(METHOD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {repairErrors.method && <small className="field-error"><ErrorLine>{repairErrors.method}</ErrorLine></small>}
            </label>
            <label className="field">
              <span>Repair note</span>
              <input type="text" aria-label="Repair note" value={repairNote} readOnly={readOnly} onChange={(e) => setRepairNote(e.target.value)} autoComplete="off" />
              {repairErrors.note && <small className="field-error"><ErrorLine>{repairErrors.note}</ErrorLine></small>}
            </label>
            <button type="submit" className="btn" disabled={readOnly || pending} aria-busy={pending}>Record repair</button>
          </form>
        </>
      )}
      <p role="status" aria-label="Editor status" className="editor-status">{status}</p>
      {current && (
        <ol role="list" aria-label="History" className="history">
          {history.map((entry, i) => (
            <li key={i}>
              <span className="num">{time(entry.at)}</span> · {entry.device_name} · {entry.action}
              {Object.entries(entry.changes).map(([field, change]) => (
                <div key={field} className="num">{`${field}: ${show(change.before)} → ${show(change.after)}`}</div>
              ))}
            </li>
          ))}
        </ol>
      )}
      {confirming && current && (
        <Confirm title="Delete defect" action="Delete" pending={deleting} restoreFocus={restoreOnClose} onConfirm={() => void remove()} onClose={() => setConfirming(false)}
          message={`Remove ${current.id} from the pen? It stays listed as a removed defect.`} />
      )}
    </section>
  );
}
