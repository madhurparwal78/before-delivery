// The yard: the intake bench (tag a board, mark defects by touch, add photos) beside the saw queue.
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Board, Lot, Photo, Ticket } from "../../shared/api";
import { DEFECT_KINDS, SPECIES, TICKET_LABELS, type DefectKind, type DefectZone } from "../../shared/domain";
import { api, upload } from "../api";
import { Link } from "../app";
import { Dialog } from "../dialog";
import { Strip } from "../drawing";
import { Icon } from "../icons";

const KIND_BUTTONS: [DefectKind, string][] = [["nail hole", "Nail hole"], ["check", "Check"], ["bolt hole", "Bolt hole"]];
const snap10 = (mm: number): number => Math.floor(mm / 10 + 0.5) * 10;
const asNumber = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : text);
const validLength = (text: string): number | null => {
  const v = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  return v >= 300 && v <= 12_000 ? v : null;
};

function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (el === null) return;
    observer.current = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.floor(e.contentRect.width));
    });
    observer.current.observe(el);
  }, []);
  return [width, ref] as const;
}

function IntakeForm() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [lot, setLot] = useState("");
  const [species, setSpecies] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [zones, setZones] = useState<DefectZone[]>([]);
  const [defectStart, setDefectStart] = useState("");
  const [defectEnd, setDefectEnd] = useState("");
  const [defectKind, setDefectKind] = useState<DefectKind>("nail hole");
  const [defectError, setDefectError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [drag, setDrag] = useState<{ from: number; to: number; pointer: number } | null>(null);
  const [picked, setPicked] = useState("");
  const [pendingZone, setPendingZone] = useState<{ start: number; end: number } | null>(null);
  const [stripWidth, stripCell] = useWidth();
  const strip = useRef<SVGSVGElement>(null);
  const photos = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ lots: Lot[] }>("GET", "/api/lots").then((r) => r.ok && setLots(r.data.lots));
  }, []);

  const boardLength = validLength(length);
  const scale = boardLength === null || stripWidth === 0 ? 0 : stripWidth / boardLength;

  const mmAt = (e: ReactPointerEvent<SVGSVGElement>): number => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(Math.max(snap10((e.clientX - box.left) / scale), 0), boardLength ?? 0);
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (boardLength === null || scale === 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    const at = mmAt(e);
    setDrag({ from: at, to: at, pointer: e.pointerId });
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag === null || e.pointerId !== drag.pointer) return;
    setDrag({ ...drag, to: mmAt(e) });
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (drag === null || e.pointerId !== drag.pointer) return;
    const to = mmAt(e);
    const start = Math.min(drag.from, to);
    const end = Math.max(drag.from, to);
    setDrag(null);
    if (start < end) setPendingZone({ start, end });
  };

  const chooseKind = (kind: DefectKind): void => {
    if (pendingZone) setZones((z) => [...z, { kind, start_mm: pendingZone.start, end_mm: pendingZone.end }]);
    setPendingZone(null);
  };

  const addDefect = (): void => {
    const s = Number(defectStart);
    const e = Number(defectEnd);
    if (!/^\d+$/.test(defectStart.trim()) || !/^\d+$/.test(defectEnd.trim()) || s >= e || (boardLength !== null && e > boardLength)) {
      setDefectError("Enter a start before the end, in whole millimetres inside the board.");
      return;
    }
    setDefectError("");
    setZones((z) => [...z, { kind: defectKind, start_mm: s, end_mm: e }]);
    setDefectStart("");
    setDefectEnd("");
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setStatus("");
    const r = await api<{ board: Board }>("POST", "/api/boards", {
      lot, species, length_mm: asNumber(length), width_mm: asNumber(width), thickness_mm: asNumber(thickness), defects: zones,
    });
    if (!r.ok) {
      setPending(false);
      setErrors(r.error.fields ?? {});
      setStatus(r.status === 422 ? "Check the highlighted fields." : "Something went wrong. Try again.");
      return;
    }
    setErrors({});
    const tag = r.data.board.tag;
    let photosSaved = true;
    for (const file of [...(photos.current?.files ?? [])]) {
      const up = await upload<{ photo: Photo }>(`/api/boards/${tag}/photos`, file, file.type || "application/octet-stream");
      if (!up.ok) photosSaved = false;
    }
    setPending(false);
    setStatus(photosSaved ? `Tagged ${tag}.` : `Tagged ${tag}. Photos were not saved.`);
    setLength("");
    setWidth("");
    setThickness("");
    setZones([]);
    if (photos.current) photos.current.value = "";
    setPicked("");
  };

  const fieldError = (key: string) => (errors[key] ? <span className="field-error">{errors[key]}</span> : null);
  const preview = drag && drag.from !== drag.to ? { start: Math.min(drag.from, drag.to), end: Math.max(drag.from, drag.to) } : pendingZone;

  return (
    <form className="intake" onSubmit={(e) => void submit(e)} noValidate>
      <div className="intake-fields">
        <label className="field">
          <span>Lot</span>
          <select value={lot} onChange={(e) => setLot(e.target.value)} aria-invalid={errors["lot"] ? true : undefined}>
            <option value="">Choose a lot</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {fieldError("lot")}
        </label>
        <label className="field">
          <span>Species</span>
          <select value={species} onChange={(e) => setSpecies(e.target.value)} aria-invalid={errors["species"] ? true : undefined}>
            <option value="">Choose a species</option>
            {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {fieldError("species")}
        </label>
        {([["Length (mm)", length, setLength, "length_mm"], ["Width (mm)", width, setWidth, "width_mm"], ["Thickness (mm)", thickness, setThickness, "thickness_mm"]] as const).map(([label, value, set, key]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input type="text" inputMode="numeric" className="mono" value={value} onChange={(e) => set(e.target.value)} aria-invalid={errors[key] ? true : undefined} />
            {fieldError(key)}
          </label>
        ))}
      </div>
      <div className="intake-strip full-bleed" ref={stripCell}>
        <Strip
          ref={strip}
          label="Intake strip"
          className="intake-svg"
          width={stripWidth}
          scale={scale}
          lengthMm={boardLength}
          defects={zones}
          boardHeight={56}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
        >
          {preview && <rect className="zone-preview" x={preview.start * scale} y={1} width={(preview.end - preview.start) * scale} height={54} />}
          {boardLength === null && (
            <>
              <rect x={0.5} y={0.5} width={Math.max(stripWidth - 1, 0)} height={55} className="strip-empty" />
              <text x={14} y={33} className="strip-hint">Type a length to draw the board</text>
            </>
          )}
        </Strip>
      </div>
      <p className="hint">Drag along the strip to mark a defect zone, or type it below.</p>
      <div className="defect-keys">
        <label className="field"><span>Defect start (mm)</span>
          <input type="text" inputMode="numeric" className="mono" value={defectStart} onChange={(e) => setDefectStart(e.target.value)} /></label>
        <label className="field"><span>Defect end (mm)</span>
          <input type="text" inputMode="numeric" className="mono" value={defectEnd} onChange={(e) => setDefectEnd(e.target.value)} /></label>
        <label className="field"><span>Defect kind</span>
          <select value={defectKind} onChange={(e) => setDefectKind(e.target.value as DefectKind)}>
            {DEFECT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select></label>
        <button type="button" className="quiet" onClick={addDefect}>Add defect</button>
      </div>
      {defectError && <p className="field-error">{defectError}</p>}
      <ul aria-label="Defect zones" className="zones">
        {zones.map((z, i) => (
          <li key={`${z.kind}-${z.start_mm}-${z.end_mm}-${i}`} className={errors[`defects.${i}`] ? "invalid" : undefined}>
            <span className="mono">{z.kind} {z.start_mm}–{z.end_mm} mm</span>
            <button type="button" className="quiet small" onClick={() => setZones((all) => all.filter((_, j) => j !== i))}>Remove defect {i + 1}</button>
          </li>
        ))}
      </ul>
      {fieldError("defects")}
      <div className="field">
        <span>Board photos</span>
        <label className="file-pick">
          <input ref={photos} type="file" accept="image/jpeg,image/png" capture="environment" multiple aria-label="Board photos"
            onChange={(e) => setPicked([...(e.target.files ?? [])].map((f) => f.name).join(", "))} />
          <Icon name="upload" /><span>Take or choose photos</span>
        </label>
        <span className="hint">{picked || "JPEG or PNG, up to 8 per board"}</span>
      </div>
      <button type="submit" className="primary" disabled={pending}>{pending ? "Tagging" : "Tag board"}</button>
      <div role="status" aria-label="Intake status" className="status-line">{status}</div>
      <Dialog open={pendingZone !== null} title="Defect kind" variant="sheet" onClose={() => setPendingZone(null)} returnFocus={strip}>
        {pendingZone && <p className="mono measure sheet-note">{pendingZone.start}–{pendingZone.end} mm</p>}
        <div className="kind-buttons">
          {KIND_BUTTONS.map(([kind, label]) => (
            <button key={kind} type="button" className="kind" onClick={() => chooseKind(kind)}>{label}</button>
          ))}
        </div>
      </Dialog>
    </form>
  );
}

type SawTicket = Ticket;

function SawQueue() {
  const [tickets, setTickets] = useState<SawTicket[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<SawTicket | null>(null);
  const [measured, setMeasured] = useState("");
  const [saving, setSaving] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ tickets: Ticket[] }>("GET", "/api/tickets");
    if (r.ok) setTickets(r.data.tickets.filter((t) => t.status !== "done"));
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const conflict = async (id: string): Promise<void> => {
    const r = await api<{ ticket: Ticket }>("GET", `/api/tickets/${id}`);
    if (!r.ok) {
      setStatus("Not saved.");
      return;
    }
    const t = r.data.ticket;
    setTickets((all) => (t.status === "done" ? all.filter((x) => x.id !== id) : all.map((x) => (x.id === id ? t : x))));
    const by = t.events[t.events.length - 1]?.by.name ?? "";
    setStatus(t.status === "done" ? `Ticket ${id} was already marked done by ${by}.` : `Ticket ${id} was already started by ${by}.`);
  };

  const start = async (t: SawTicket): Promise<void> => {
    setBusy(t.id);
    const r = await api<{ ticket: Ticket }>("POST", `/api/tickets/${t.id}/start`, {});
    setBusy(null);
    if (r.ok) {
      setTickets((all) => all.map((x) => (x.id === t.id ? r.data.ticket : x)));
      setStatus(`Ticket ${t.id} is at the saw.`);
    } else if (r.error.error === "ticket_state") await conflict(t.id);
    else setStatus("Something went wrong. Try again.");
  };

  const save = async (): Promise<void> => {
    if (measuring === null || saving) return;
    const t = measuring;
    setSaving(true);
    const body = t.offcut ? { offcut_mm: asNumber(measured) } : {};
    const r = await api<{ ticket: Ticket }>("POST", `/api/tickets/${t.id}/done`, body);
    setSaving(false);
    if (r.ok) {
      const done = r.data.ticket;
      setMeasuring(null);
      setTickets((all) => all.filter((x) => x.id !== t.id));
      setStatus(done.offcut ? `Ticket ${t.id} done. Offcut ${done.offcut.tag} is ${done.offcut.measured_mm ?? ""} mm.` : `Ticket ${t.id} done.`);
    } else if (r.error.error === "ticket_state") {
      setMeasuring(null);
      await conflict(t.id);
    } else setStatus("Not saved.");
  };

  return (
    <>
      <ul className="saw-list" aria-label="Tickets at the saw">
        {tickets.length === 0 && <li className="muted">No tickets waiting for the saw.</li>}
        {tickets.map((t) => (
          <li key={t.id} className="saw-row">
            <div>
              <Link to={`/tickets/${t.id}`} className="mono">{t.id}</Link>
              <span className="mono"> · {t.board}</span>
              <span className={`badge ${t.status}`}>{TICKET_LABELS[t.status]}</span>
            </div>
            {t.status === "issued" ? (
              <button type="button" className="quiet" disabled={busy === t.id} onClick={() => void start(t)}>
                {busy === t.id ? "Starting" : `Start cut ${t.id}`}
              </button>
            ) : (
              <button
                type="button"
                className="quiet"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setMeasured("");
                  setMeasuring(t);
                }}
              >{`Mark ${t.id} done`}</button>
            )}
          </li>
        ))}
      </ul>
      <div role="status" aria-label="Saw status" className="status-line">{status}</div>
      <Dialog open={measuring !== null} title="Re-measure offcut" variant="dialog" onClose={() => setMeasuring(null)} returnFocus={opener}>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          {measuring?.offcut && (
            <label className="field">
              <span>Measured offcut (mm)</span>
              <input type="text" inputMode="numeric" className="mono" value={measured} onChange={(e) => setMeasured(e.target.value)} />
              <span className="hint mono">Planned {measuring.offcut.planned_mm} mm</span>
            </label>
          )}
          {measuring && !measuring.offcut && <p>This ticket has no offcut.</p>}
          <div className="dialog-actions">
            <button type="submit" className="primary" disabled={saving}>{saving ? "Saving" : "Save"}</button>
            <button type="button" className="quiet" onClick={() => setMeasuring(null)}>Close</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function YardPage() {
  return (
    <div className="yard">
      <h1 className="page-title">Yard</h1>
      <section className="tag-section" aria-labelledby="tag-heading">
        <h2 id="tag-heading">Tag a board</h2>
        <IntakeForm />
      </section>
      <section className="saw-section" aria-labelledby="saw-heading">
        <h2 id="saw-heading">Saw queue</h2>
        <SawQueue />
      </section>
    </div>
  );
}
