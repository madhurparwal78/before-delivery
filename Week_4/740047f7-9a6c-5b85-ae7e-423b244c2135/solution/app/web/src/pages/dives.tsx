import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, get, post, upload, type Dive, type Pen } from "../api";
import { clock, pad2, utcStamp } from "../format";
import { useLive } from "../shell";
import { Dialog, ErrorLine, useDialog, useInterval } from "../ui";

const num = (text: string | undefined): number | string | null => (text === undefined || text === "" ? null : Number.isNaN(Number(text)) ? text : Number(text));

export function DivesPage() {
  const [dives, setDives] = useState<Dive[] | null>(null);
  const [pens, setPens] = useState<Pen[]>([]);
  const [now, setNow] = useState<{ iso: string; at: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ dive: Dive; at: number } | null>(null);
  const [action, setAction] = useState("");
  const [track, setTrack] = useState("");
  const [trackError, setTrackError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [, tick] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const flag = (name: string, on: boolean) => setPending((p) => (on ? [...p, name] : p.filter((x) => x !== name)));
  const checkSeq = useRef(0);
  const detailSeq = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const busy = useRef({ start: false, finish: false, sonar: false });
  const files = useRef<HTMLInputElement>(null);
  const lastMessage = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    try {
      const reply = await get<{ server_now: string; dives: Dive[] }>("/api/dives", { silent: true });
      if (!alive.current) return;
      setDives(reply.dives);
      setNow({ iso: reply.server_now, at: performance.now() });
      setSelected((cur) => cur ?? reply.dives[0]?.id ?? null);
    } catch { /* the next refresh tries again */ }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const mine = ++detailSeq.current;
    try {
      const reply = await get<{ dive: Dive }>(`/api/dives/${id}`, { silent: true });
      if (!alive.current || mine !== detailSeq.current) return;
      setDetail({ dive: reply.dive, at: performance.now() });
      if (lastMessage.current !== undefined && lastMessage.current !== reply.dive.clearance?.message) setAction("");
      lastMessage.current = reply.dive.clearance?.message;
    } catch { /* the next refresh tries again */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadList();
    get<{ pens: Pen[] }>("/api/pens", { silent: true }).then((r) => alive.current && setPens(r.pens), () => undefined);
    return () => { alive.current = false; };
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    lastMessage.current = undefined;
    void loadDetail(selected);
  }, [selected, loadDetail]);

  const refresh = useCallback(() => {
    void loadList();
    if (selectedRef.current) void loadDetail(selectedRef.current);
  }, [loadList, loadDetail]);
  useInterval(refresh, 30000);
  useLive((event) => { if (event.type === "dive.changed" || event.type === "resync") refresh(); });
  const dive = detail?.dive;
  useInterval(() => tick((n) => n + 1), 1000, dive?.status === "started");

  const choose = (id: string) => {
    if (id === selected) return;
    detailSeq.current += 1;
    setDetail(null);
    setAction("");
    setTrack("");
    setTrackError("");
    setSelected(id);
  };

  const applyDive = (next: Dive) => {
    setDetail({ dive: next, at: performance.now() });
    setDives((list) => list?.map((d) => (d.id === next.id ? next : d)) ?? list);
    lastMessage.current = next.clearance?.message;
  };

  const check = async () => {
    if (!dive) return;
    const mine = ++checkSeq.current;
    const id = dive.id;
    setAction("Checking forecast…");
    try {
      const reply = await post<{ dive: Dive }>(`/api/dives/${id}/clearance`);
      if (mine !== checkSeq.current || selectedRef.current !== id) return;
      applyDive(reply.dive);
      setAction(reply.dive.clearance?.message ?? "");
    } catch (error) {
      if (mine !== checkSeq.current || selectedRef.current !== id) return;
      setAction(error instanceof ApiFailure ? error.message : "");
      void loadDetail(id);
    }
    void loadList();
  };

  const start = async () => {
    if (!dive || busy.current.start) return;
    busy.current.start = true;
    flag("start", true);
    const id = dive.id;
    setAction("Starting dive…");
    try {
      const reply = await post<{ dive: Dive }>(`/api/dives/${id}/start`);
      if (selectedRef.current === id) { applyDive(reply.dive); setAction("Dive started"); }
    } catch (error) {
      if (selectedRef.current === id) setAction(error instanceof ApiFailure ? error.message : "");
    } finally {
      busy.current.start = false;
      flag("start", false);
    }
    void loadList();
  };

  const finish = async () => {
    if (!dive || busy.current.finish) return;
    busy.current.finish = true;
    flag("finish", true);
    const id = dive.id;
    const rows = track.split("\n").map((text, i) => ({ text: text.trim(), line: i + 1 })).filter((r) => r.text !== "");
    const samples = rows.map((r) => {
      const [t, bearing, depth] = r.text.split(",").map((x) => x.trim());
      return { t_s: num(t), bearing_deg: num(bearing), depth_m: num(depth) };
    });
    setAction("Finishing dive…");
    setTrackError("");
    try {
      const reply = await post<{ dive: Dive }>(`/api/dives/${id}/finish`, { track: samples });
      if (selectedRef.current === id) { applyDive(reply.dive); setAction("Dive recorded"); }
    } catch (error) {
      if (selectedRef.current !== id || !(error instanceof ApiFailure)) { setAction(""); } else if (error.status === 422 && error.fields) {
        const key = Object.keys(error.fields).find((k) => k.startsWith("track["));
        const index = key ? Number(key.slice(6, -1)) : -1;
        setTrackError(key && rows[index] ? `Track row ${rows[index].line} is invalid: ${error.fields[key]}` : error.fields.track ?? error.message);
        setAction("");
      } else {
        setAction(error.message);
      }
    } finally {
      busy.current.finish = false;
      flag("finish", false);
    }
    void loadList();
  };

  const attach = async (file: File | undefined) => {
    if (!file || !dive || busy.current.sonar) return;
    busy.current.sonar = true;
    flag("sonar", true);
    const id = dive.id;
    setAction("Uploading sonar capture…");
    try {
      const reply = await upload<{ capture: { id: string } }>(`/api/dives/${id}/sonar`, file, "application/octet-stream");
      if (selectedRef.current === id) { setAction(`Attached sonar capture ${reply.capture.id}`); void loadDetail(id); }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 413) setAction("Sonar capture is larger than 20,000,000 bytes");
      else setAction(error instanceof ApiFailure ? error.message : "");
    } finally {
      busy.current.sonar = false;
      flag("sonar", false);
      if (files.current) files.current.value = "";
    }
  };

  const penName = (id: string) => pens.find((p) => p.id === id)?.name ?? id;
  const elapsed = dive?.status === "started" && detail ? (dive.elapsed_s ?? 0) + (performance.now() - detail.at) / 1000 : null;
  const clearanceText = action || dive?.clearance?.message || "";

  return (
    <div className="dives-page">
      <div className="page-head">
        <h1>Dives</h1>
        <button type="button" className="btn btn-solid" onClick={() => setPlanning(true)}>Plan dive</button>
      </div>
      <div className="dives-grid">
        <div className="dives-list">
          {!dives ? <div className="skeleton rows-skeleton" aria-hidden="true" /> : (
            <ul role="list" aria-label="Dives" className="plain">
              {dives.map((d) => (
                <li key={d.id}>
                  <button type="button" className={d.id === selected ? "row selected" : "row"} aria-describedby={`dive-detail-${d.id}`} onClick={() => choose(d.id)}>
                    <span className="row-main num">{d.id}, {penName(d.pen_id)}<span aria-hidden="true"> · {utcStamp(d.planned_start)}</span></span>
                    <span className="row-tag" aria-hidden="true">{d.status}</span>
                  </button>
                  <span className="visually-hidden" id={`dive-detail-${d.id}`}>{utcStamp(d.planned_start)}. {d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <section className="dive-detail" aria-label="Dive detail">
          {!dive ? <div className="skeleton detail-skeleton" aria-hidden="true" /> : (
            <>
              <h2>{penName(dive.pen_id)}</h2>
              <p className="num muted">{utcStamp(dive.planned_start)} · {dive.planned_minutes} min</p>
              <p role="status" aria-label="Dive status">{`Dive status: ${dive.status}`}</p>
              <div className="detail-actions">
                <button type="button" className="btn" onClick={() => void check()}>Check forecast</button>
                <button type="button" className="btn" disabled={pending.includes("start")} aria-busy={pending.includes("start")} onClick={() => void start()}>Start dive</button>
                <button type="button" className="btn" disabled={pending.includes("finish")} aria-busy={pending.includes("finish")} onClick={() => void finish()}>Finish dive</button>
                <button type="button" className="btn" disabled={pending.includes("sonar")} aria-busy={pending.includes("sonar")} onClick={() => files.current?.click()}>Attach sonar capture</button>
                <input ref={files} type="file" hidden tabIndex={-1} onChange={(e) => void attach(e.target.files?.[0])} />
              </div>
              <p role="status" aria-label="Clearance status" className="clearance-status">{clearanceText}</p>
              {dive.clearance && dive.clearance.hours.length > 0 && (
                <table aria-label="Forecast hours" className="num">
                  <thead><tr><th>Time</th><th>Current (m/s)</th><th>Wave height (m)</th><th>Within limits</th></tr></thead>
                  <tbody>
                    {dive.clearance.hours.map((h) => (
                      <tr key={h.time}><td>{`${pad2(new Date(h.time).getUTCHours())}:00 UTC`}</td><td>{h.current_m_s.toFixed(2)}</td><td>{h.wave_m.toFixed(1)}</td><td>{h.within_limits ? "Yes" : "No"}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {elapsed !== null && <p>Dive clock <span role="timer" aria-label="Dive clock" className="num big">{clock(elapsed)}</span></p>}
              <label className="field">
                <span>Track samples</span>
                <textarea aria-label="Track samples" rows={4} value={track} placeholder="0,0.0,1.0" onChange={(e) => setTrack(e.target.value)} />
                <small className="field-hint">One sample per line: t_s,bearing_deg,depth_m</small>
                {trackError && <small className="field-error"><ErrorLine>{trackError}</ErrorLine></small>}
              </label>
              <table aria-label="Track" className="num">
                <thead><tr><th>Time (s)</th><th>Bearing (°)</th><th>Depth (m)</th></tr></thead>
                <tbody>
                  {dive.track.map((s, i) => <tr key={i}><td>{s.t_s}</td><td>{s.bearing_deg.toFixed(1)}</td><td>{s.depth_m.toFixed(1)}</td></tr>)}
                </tbody>
              </table>
              <ul role="list" aria-label="Sonar captures" className="plain">
                {dive.sonar.map((c) => <li key={c.id}><a href={`/api/sonar/${c.id}/raw`} download={c.file_name} aria-label={`Download sonar ${c.id}`}>{c.id} · {c.file_name}</a></li>)}
              </ul>
            </>
          )}
        </section>
      </div>
      {planning && (
        <PlanDialog pens={pens} now={now} onClose={() => setPlanning(false)} onPlanned={(d) => { setPlanning(false); void loadList(); choose(d.id); }} />
      )}
    </div>
  );
}

function nextHour(now: { iso: string; at: number } | null): string {
  const at = new Date((now ? Date.parse(now.iso) + (performance.now() - now.at) : Date.now()));
  at.setUTCMinutes(0, 0, 0);
  at.setUTCHours(at.getUTCHours() + 1);
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())} ${pad2(at.getUTCHours())}:00`;
}

function PlanDialog({ pens, now, onClose, onPlanned }: { pens: Pen[]; now: { iso: string; at: number } | null; onClose: () => void; onPlanned: (d: Dive) => void }) {
  const [penId, setPenId] = useState(pens[0]?.id ?? "");
  const [start, setStart] = useState(() => nextHour(now));
  const [minutes, setMinutes] = useState("90");
  const [certificate, setCertificate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(start.trim());
    try {
      const reply = await post<{ dive: Dive }>("/api/dives", {
        pen_id: penId || pens[0]?.id, planned_start: match ? `${match[1]}T${match[2]}:00Z` : start,
        planned_minutes: num(minutes), diver_certificate_no: certificate,
      });
      onPlanned(reply.dive);
    } catch (error) {
      if (error instanceof ApiFailure && error.fields) setErrors(error.fields);
    } finally {
      setPending(false);
    }
  };
  const err = (key: string) => errors[key] && <small className="field-error"><ErrorLine>{errors[key]}</ErrorLine></small>;
  return (
    <Dialog title="Plan dive" onClose={onClose}>
      <h2>Plan dive</h2>
      <form onSubmit={submit}>
        <label className="field"><span>Pen</span>
          <select aria-label="Pen" value={penId || pens[0]?.id} onChange={(e) => setPenId(e.target.value)}>
            {pens.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>{err("pen_id")}
        </label>
        <label className="field"><span>Planned start (UTC)</span><input type="text" aria-label="Planned start (UTC)" value={start} onChange={(e) => setStart(e.target.value)} autoComplete="off" />{err("planned_start")}</label>
        <label className="field"><span>Planned minutes</span><input type="text" inputMode="numeric" aria-label="Planned minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} autoComplete="off" />{err("planned_minutes")}</label>
        <label className="field"><span>Diver certificate number</span><input type="text" aria-label="Diver certificate number" value={certificate} onChange={(e) => setCertificate(e.target.value)} autoComplete="off" />{err("diver_certificate_no")}</label>
        <div className="dialog-actions"><CancelButton /><button type="submit" className="btn btn-solid" disabled={pending}>Plan</button></div>
      </form>
    </Dialog>
  );
}

function CancelButton() {
  const dialog = useDialog();
  return <button type="button" className="btn" onClick={() => dialog?.close()}>Cancel</button>;
}
