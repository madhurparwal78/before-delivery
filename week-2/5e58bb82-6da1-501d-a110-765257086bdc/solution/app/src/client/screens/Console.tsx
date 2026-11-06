// The mission console: header with the four groups, the chart with the holiday lens (or the coverage table),
// the mission's alerts and vessels, lines, infill queues, holidays and the owner's mission actions.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { api, NoResponse, Stale, type Coverage, type Holiday, type Line, type Mission, type Position, type Track } from "../api";
import { AlertsRegion } from "../components/AlertsRegion";
import { Chart } from "../components/Chart";
import { CoverageGrid } from "../components/CoverageGrid";
import { Dialog, Sheet } from "../components/Dialog";
import { useFleetWatch } from "../components/fleetWatch";
import { MissionHeader } from "../components/MissionHeader";
import { VesselCards } from "../components/VesselCards";
import { useAnnouncer, usePoll, useReducedMotion, useTier } from "../hooks";
import { navigate, useLocation } from "../router";
import { useSession } from "../session";
import { area as formatArea, fromLength, length, toLength } from "../units";
import { NotFound } from "./NotFound";

const KIND: Record<Line["kind"], string> = { planned: "Planned", crossline: "Crossline", infill: "Infill" };
const ORDER: Record<string, string> = { special: "Special Order", "1a": "Order 1a" };
const ACTIVE = new Set(["Launched", "Surveying", "Recovering"]);
const OPEN = new Set(["Planned", ...ACTIVE]);

interface Data {
  mission: Mission;
  lines: Line[];
  coverage: Coverage;
  holidays: Holiday[];
  tracks: Track[];
  queues: Record<string, string[]>;
}

type Modal = "abort" | "hold" | "handover" | "geofence" | { rerun: Line } | null;

export function Console({ missionId }: { missionId: string }) {
  const { user } = useSession();
  const tier = useTier();
  const reduced = useReducedMotion();
  const { search } = useLocation();
  const tableView = new URLSearchParams(search).get("view") === "table";
  const [announcements, announce] = useAnnouncer();
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [gridCell, setGridCell] = useState<{ at: Position; holiday: Holiday | null } | null>(null);
  const seenHolidays = useRef<Map<string, string> | null>(null);
  const seenInfill = useRef<Map<string, string | null> | null>(null);
  const ownMoves = useRef(new Set<string>());
  const focusLine = useRef<string | null>(null);
  const focusQueueRow = useRef<string | null>(null);
  const linesTable = useRef<HTMLDivElement>(null);
  const missionStatus = useCallback(() => data?.mission.status, [data?.mission.status]);
  const vesselIds = new Set(data?.mission.vessels.map((v) => v.id) ?? []);
  const { vessels, alerts, applyAlert } = useFleetWatch({ announce, missionId, vesselIds, missionStatus });

  const load = usePoll(async () => {
    const base = `/api/missions/${missionId}`;
    const [m, l, c, h, t] = await Promise.all([
      api<Mission>(base), api<Line[]>(`${base}/lines`), api<Coverage>(`${base}/coverage`), api<Holiday[]>(`${base}/holidays`), api<{ tracks: Track[] }>(`${base}/tracks`),
    ]);
    if (m.status === 404) {
      setData(null);
      return;
    }
    if (!(m.ok && l.ok && c.ok && h.ok && t.ok)) return;
    const queueVessels = [...new Set(l.data.flatMap((x) => (x.kind === "infill" && x.status === "Assigned" && x.vessel_id ? [x.vessel_id] : [])))];
    const queues: Record<string, string[]> = {};
    for (const vid of queueVessels) {
      const q = await api<{ line_ids: string[] }>(`${base}/vessels/${vid}/infill-order`);
      if (q.ok) queues[vid] = q.data.line_ids;
    }
    if (seenHolidays.current) {
      for (const hol of h.data) if (hol.status === "Closed" && seenHolidays.current.get(hol.id) && seenHolidays.current.get(hol.id) !== "Closed") announce(`${hol.label} closed`);
    }
    if (seenInfill.current) {
      for (const line of l.data) {
        if (line.kind !== "infill") continue;
        const before = seenInfill.current.get(line.id);
        if (before !== undefined && before !== line.vessel_id && line.vessel_name && !ownMoves.current.has(line.id)) announce(`Infill ${line.label} moved to ${line.vessel_name}`);
      }
    }
    ownMoves.current.clear();
    seenHolidays.current = new Map(h.data.map((x) => [x.id, x.status]));
    seenInfill.current = new Map(l.data.filter((x) => x.kind === "infill").map((x) => [x.id, x.vessel_id]));
    setData({ mission: m.data, lines: l.data, coverage: c.data, holidays: h.data, tracks: t.data.tracks, queues });
  }, 2000, [missionId]);

  useLayoutEffect(() => {
    if (focusLine.current) {
      const row = linesTable.current?.querySelector<HTMLElement>(`tr[data-line="${focusLine.current}"]`);
      if (row) {
        focusLine.current = null;
        row.scrollIntoView({ block: "nearest" });
        row.focus();
      }
    }
    if (focusQueueRow.current) {
      document.querySelector<HTMLElement>(`li[data-queue="${focusQueueRow.current}"]`)?.focus();
      focusQueueRow.current = null;
    }
  });

  const queue = useCallback(async (holiday: Holiday, fromList: boolean) => {
    if (pending.has(holiday.id) || !data) return;
    setPending((p) => new Set(p).add(holiday.id));
    announce(`Queueing infill for ${holiday.label}`);
    try {
      const r = await api<{ line: Line; holiday: Holiday; counters: Mission["counters"] }>(`/api/missions/${missionId}/holidays/${holiday.id}/infill`, { method: "POST", body: {} });
      if (r.ok) {
        const { line, holiday: updated, counters } = r.data;
        ownMoves.current.add(line.id);
        seenInfill.current?.set(line.id, line.vessel_id);
        setData((d) => d && {
          ...d,
          mission: { ...d.mission, counters },
          lines: d.lines.some((x) => x.id === line.id) ? d.lines.map((x) => (x.id === line.id ? line : x)) : [...d.lines, line],
          holidays: d.holidays.map((x) => (x.id === updated.id ? updated : x)),
        });
        announce(r.status === 201 ? `Infill ${line.label} queued to ${line.vessel_name}` : `Infill ${line.label} is already queued to ${line.vessel_name}`);
        if (fromList && (tier !== "medium" || detailOpen)) focusLine.current = line.id;
      } else announce(r.error?.message ?? `${holiday.label} is not queued`);
    } catch (e) {
      if (e instanceof NoResponse) announce(`Could not reach Swathdeck — ${holiday.label} is not queued yet`);
      else if (!(e instanceof Stale)) throw e;
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(holiday.id);
        return next;
      });
    }
  }, [announce, data, detailOpen, missionId, pending, tier]);

  if (data === null) return <NotFound />;
  if (!data) return <main className="page"><p className="muted">Loading mission…</p></main>;
  const { mission, lines } = data;
  const openHolidays = data.holidays.filter((h) => h.status !== "Closed");
  const isPS = user.role === "principal_surveyor";
  const isOwner = mission.owner_id === user.id;
  const missionVessels = (vessels ?? []).filter((v) => vesselIds.has(v.id));

  const act = async (pendingText: string, path: string, body: unknown, success: (m: Mission) => string, method = "POST") => {
    announce(pendingText);
    try {
      const r = await api<Mission | { line: Line }>(`/api/missions/${missionId}${path}`, { method, body });
      if (!r.ok) {
        announce(r.error?.message ?? "Not done");
        return r;
      }
      if ("id" in (r.data as Mission)) setData((d) => d && { ...d, mission: r.data as Mission });
      const text = success(r.data as Mission);
      if (text) announce(text);
      load();
      return r;
    } catch (e) {
      if (e instanceof NoResponse) announce("Could not reach Swathdeck — nothing changed yet");
      else if (!(e instanceof Stale)) throw e;
      return null;
    }
  };

  const reorder = async (vesselId: string, lineId: string, delta: number) => {
    const order = data.queues[vesselId] ?? [];
    const i = order.indexOf(lineId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    const vesselName = vessels?.find((v) => v.id === vesselId)?.name ?? "";
    try {
      const r = await api<{ line_ids: string[] }>(`/api/missions/${missionId}/vessels/${vesselId}/infill-order`, { method: "PUT", body: { line_ids: next } });
      if (r.ok) {
        focusQueueRow.current = lineId;
        setData((d) => d && { ...d, queues: { ...d.queues, [vesselId]: r.data.line_ids } });
        const label = lines.find((l) => l.id === lineId)?.label;
        announce(`${label} moved to position ${r.data.line_ids.indexOf(lineId) + 1} of ${r.data.line_ids.length}`);
      } else if (r.error?.error === "stale_order") {
        announce(`The infill queue for ${vesselName} has changed — showing the latest order`);
        load();
      } else announce(r.error?.message ?? "The infill order is unchanged");
    } catch (e) {
      if (e instanceof NoResponse) announce("Could not reach Swathdeck — the infill order is unchanged");
      else if (!(e instanceof Stale)) throw e;
    }
  };

  const ownerAction = (label: string, onClick: () => void, show: boolean) => show && (
    <button type="button" disabled={!isOwner} onClick={onClick}>{label}</button>
  );

  const header = (
    <MissionHeader mission={mission}>
      {isPS && ownerAction("Launch mission", () => void act("Launching mission", "/transitions", { to: "Launched" }, () => "Mission launched"), mission.status === "Planned")}
      {isPS && ownerAction("Abort mission", () => setModal("abort"), ACTIVE.has(mission.status))}
      {isPS && ownerAction("Hold for weather", () => setModal("hold"), mission.status === "Surveying" && !mission.hold)}
      {isPS && ownerAction("Resume survey", () => void act("Resuming survey", "/resume", {}, () => "Survey resumed"), !!mission.hold)}
      {isPS && ownerAction("Edit geofence", () => setModal("geofence"), mission.status === "Launched" || mission.status === "Surveying")}
      {isPS && ownerAction("Hand over", () => setModal("handover"), OPEN.has(mission.status))}
      {isPS && !isOwner && <span className="owner-note">Owned by {mission.owner_name}</span>}
      <button type="button" aria-pressed={tableView} onClick={() => {
        const p = new URLSearchParams(search);
        if (tableView) p.delete("view");
        else p.set("view", "table");
        const q = p.toString();
        navigate(`/missions/${missionId}${q ? `?${q}` : ""}`, { replace: true });
      }}>View as table</button>
      {tier === "medium" && <button type="button" onClick={() => setDetailOpen(true)}>Mission detail</button>}
    </MissionHeader>
  );

  const linesTableEl = (
    <div ref={linesTable} className="table-scroll" tabIndex={0} role="region" aria-label="Lines table">
      <table aria-label="Lines" className="lines-table">
        <thead><tr><th>Line</th><th>Kind</th><th>Vessel</th><th>Status</th><th>File</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} data-line={l.id} tabIndex={-1}>
              <td>{l.label}</td>
              <td>{KIND[l.kind]}</td>
              <td>{l.vessel_name ?? ""}</td>
              <td>
                <div className="row status-cell">
                  <span>{l.status}</span>
                  {isPS && l.kind !== "infill" && (l.status === "Surveyed" || l.status === "Delivered") && (
                    <button type="button" disabled={!isOwner} aria-label={`Re-run ${l.label}`} onClick={() => setModal({ rerun: l })}>Re-run</button>
                  )}
                </div>
              </td>
              <td>{l.file?.state ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const queuesEl = Object.entries(data.queues).filter(([, ids]) => ids.length).map(([vid, ids]) => {
    const name = vessels?.find((v) => v.id === vid)?.name ?? vid;
    return (
      <div key={vid} className="section">
        <h3 id={`queue-${vid}`}>Infill queue for {name}</h3>
        <ol className="queue-list" aria-label={`Infill queue for ${name}`}>
          {ids.map((id, i) => {
            const line = lines.find((l) => l.id === id);
            const hol = data.holidays.find((h) => h.id === line?.holiday_id);
            return (
              <li key={id} data-queue={id} tabIndex={0} onKeyDown={(e) => {
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  if (isPS) void reorder(vid, id, e.key === "ArrowUp" ? -1 : 1);
                }
              }}>{i + 1}. {line?.label} · {hol?.label ?? ""}</li>
            );
          })}
        </ol>
      </div>
    );
  });

  const summaryEl = (
    <div role="group" aria-label="Plan summary" className="section">
      <h3>Plan summary</h3>
      <dl className="facts">
        <dt>Survey order</dt><dd>{ORDER[mission.survey_order]}</dd>
        <dt>Lines</dt><dd className="num">{mission.line_count}</dd>
        <dt>Crosslines</dt><dd className="num">{mission.crossline_count}</dd>
        <dt>Estimated duration</dt><dd className="num">{Math.round(mission.estimated_duration_s / 60)} min</dd>
        <dt>Swath width</dt><dd className="num">{length(mission.swath_width_m, user.units)}</dd>
        <dt>Line spacing</dt><dd className="num">{length(mission.line_spacing_m, user.units)}</dd>
      </dl>
    </div>
  );

  const showHolidayList = reduced || tier === "narrow";
  const holidaysEl = showHolidayList && (
    <section className="section" aria-labelledby="holidays-heading">
      <h2 id="holidays-heading">Holidays</h2>
      <ul className="holidays" aria-label="Holidays">
        {!openHolidays.length && <li>No holidays — coverage is continuous</li>}
        {openHolidays.map((h) => {
          const infill = lines.find((l) => l.id === h.infill_line_id);
          const busy = pending.has(h.id);
          return (
            <li key={h.id}>
              <span><span className="hatch" aria-hidden="true" /> {h.label} · {formatArea(h.area_m2, user.units)} · {h.nearest_vessel ? `nearest ${h.nearest_vessel.name}` : "no eligible vessel"}
                {h.status === "Queued" && infill?.vessel_name ? ` · Queued to ${infill.vessel_name}` : ""}</span>
              {isPS && <button type="button" aria-label={`Queue infill ${h.label}`} aria-disabled={busy || undefined} onClick={() => void queue(h, true)}>{busy ? "Queueing…" : "Queue infill"}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const markers = missionVessels.flatMap((v) => (v.last_fix ? [{ id: v.id, name: v.name, position: v.last_fix.position, heading: v.last_fix.heading_deg }] : []));
  const chartData = {
    areas: [{ id: mission.id, area: mission.survey_area, fence: mission.geofence }],
    lines, tracks: data.tracks, coverage: data.coverage, holidays: openHolidays, markers,
  };
  const chart = tableView ? (
    <Chart data={chartData} units={user.units} readoutOverride={gridCell ? { at: gridCell.at, holidays: gridCell.holiday ? [gridCell.holiday] : [] } : null}>
      <CoverageGrid coverage={data.coverage} holidays={openHolidays}
        onCell={(at, holiday) => setGridCell({ at, holiday })}
        onEnter={(holiday) => (holiday ? void queue(holiday, false) : announce("No holiday under the lens"))} />
    </Chart>
  ) : (
    <Chart data={chartData} units={user.units} lens={isPS} onQueue={(h) => void queue(h, false)} onNoHoliday={() => announce("No holiday under the lens")} />
  );

  const rail = (
    <>
      <div className="rail-section">
        <div className="announce" role="status" aria-live="polite" aria-label="Fleet announcements">
          {announcements.map((l, i) => <p key={`${i}-${l}`}>{l}</p>)}
        </div>
      </div>
      <AlertsRegion alerts={alerts} loaded={vessels !== null} announce={announce} applyAlert={applyAlert} />
      <VesselCards vessels={missionVessels} coverageOf={() => mission.counters.coverage_pct} />
    </>
  );

  return (
    <main className="console-main">
      {tier === "narrow" ? (
        <div className="console narrow">
          {header}
          {chart}
          <div className="list-under">
            {holidaysEl}
            {linesTableEl}
            {queuesEl}
            {summaryEl}
            {rail}
          </div>
        </div>
      ) : (
        <div className={`console ${tier}`}>
          <aside className="rail">{rail}</aside>
          <div className="mission-head-slot" style={{ gridArea: "head" }}>{header}</div>
          <div className="centre">
            {chart}
            {holidaysEl && <div className="list-under">{holidaysEl}</div>}
          </div>
          {tier === "wide" && (
            <section className="detail-pane" aria-label="Mission detail pane">
              {linesTableEl}
              {queuesEl}
              {summaryEl}
            </section>
          )}
        </div>
      )}
      {tier === "medium" && (
        <Sheet open={detailOpen} label="Mission detail" onClose={() => setDetailOpen(false)}>
          {linesTableEl}
          {queuesEl}
          {summaryEl}
        </Sheet>
      )}
      {modal === "abort" && (
        <Dialog label="Abort mission" onClose={() => setModal(null)}>
          <h2>Abort mission</h2>
          <p>Aborting ends {mission.name}. Lines keep their state and surveyed lines can still take uploads.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => {
              setModal(null);
              void act("Aborting mission", "/transitions", { to: "Aborted" }, () => "Mission aborted");
            }}>Abort mission</button>
            <button type="button" onClick={() => setModal(null)}>Keep surveying</button>
          </div>
        </Dialog>
      )}
      {modal === "hold" && (
        <ReasonDialog title="Hold for weather" action="Hold survey" max={120} onClose={() => setModal(null)}
          send={async (reason) => {
            const r = await act("Holding survey", "/hold", { reason }, () => "Survey held");
            return r?.ok ? null : r?.error?.errors?.reason ?? r?.error?.message ?? "Could not reach Swathdeck";
          }} />
      )}
      {typeof modal === "object" && modal?.rerun && (
        <ReasonDialog title="Re-run line" action="Create re-run" max={200} subtitle={modal.rerun.label} onClose={() => setModal(null)}
          send={async (reason) => {
            const line = modal.rerun;
            const r = await act("Creating re-run", `/lines/${line.id}/rerun`, { reason }, () => "");
            if (!r?.ok) return r?.error?.errors?.reason ?? r?.error?.message ?? "Could not reach Swathdeck";
            const created = (r.data as { line: Line }).line;
            setData((d) => {
              if (!d) return d;
              const at = d.lines.findIndex((x) => x.id === line.id);
              const next = [...d.lines];
              next.splice(at + 1, 0, created);
              return { ...d, lines: next };
            });
            announce(`${created.label} added — assign a vessel to run it`);
            focusLine.current = created.id;
            return null;
          }} />
      )}
      {modal === "handover" && <HandoverDialog mission={mission} onClose={() => setModal(null)} onDone={(m, name) => {
        setData((d) => d && { ...d, mission: m });
        announce(`Handed ${m.name} to ${name}`);
        setModal(null);
      }} />}
      {modal === "geofence" && <GeofenceDialog mission={mission} onClose={() => setModal(null)} onDone={(m) => {
        setData((d) => d && { ...d, mission: m });
        announce("Geofence updated");
        setModal(null);
        load();
      }} />}
    </main>
  );
}

function ReasonDialog({ title, action, max, subtitle, onClose, send }: { title: string; action: string; max: number; subtitle?: string; onClose: () => void; send: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog label={title} onClose={onClose}>
      <h2>{title}</h2>
      {subtitle && <p className="muted">{subtitle}</p>}
      <div className="field">
        <label htmlFor="reason">Reason</label>
        <input id="reason" type="text" value={reason} maxLength={max} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={async () => {
          const problem = await send(reason);
          if (problem) setError(problem);
          else onClose();
        }}>{action}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function HandoverDialog({ mission, onClose, onDone }: { mission: Mission; onClose: () => void; onDone: (m: Mission, name: string) => void }) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  usePoll(async () => {
    const r = await api<{ id: string; name: string }[]>("/api/surveyors");
    if (!r.ok) return;
    const others = r.data.filter((p) => p.id !== mission.owner_id);
    setPeople(others);
    setTo((t) => t || others[0]?.id || "");
  }, 60_000, []);
  const send = async () => {
    try {
      const r = await api<Mission>(`/api/missions/${mission.id}/handover`, { method: "POST", body: { to_user_id: to, version: mission.version } });
      if (r.ok) onDone(r.data, people.find((p) => p.id === to)?.name ?? "");
      else setError(r.error?.errors?.to_user_id ?? r.error?.message ?? null);
    } catch (e) {
      if (e instanceof NoResponse) setError(`Could not reach Swathdeck — ${mission.name} is not handed over yet`);
      else if (!(e instanceof Stale)) throw e;
    }
  };
  return (
    <Dialog label="Hand over mission" onClose={onClose}>
      <h2>Hand over mission</h2>
      <div className="field">
        <label htmlFor="surveyor">Surveyor</label>
        <select id="surveyor" value={to} onChange={(e) => setTo(e.target.value)}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void send()}>Hand over</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function GeofenceDialog({ mission, onClose, onDone }: { mission: Mission; onClose: () => void; onDone: (m: Mission) => void }) {
  const { user } = useSession();
  const [text, setText] = useState(() => mission.geofence.map((p) => `${+toLength(p.easting, user.units).toFixed(1)}, ${+toLength(p.northing, user.units).toFixed(1)}`).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const geofence = text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(line);
      return m ? { easting: fromLength(Number(m[1]), user.units), northing: fromLength(Number(m[2]), user.units) } : null;
    });
    try {
      const r = await api<Mission>(`/api/missions/${mission.id}/geofence`, { method: "PUT", body: { geofence, version: mission.version } });
      if (r.ok) onDone(r.data);
      else setError(r.error?.errors?.geofence ?? r.error?.message ?? null);
    } catch (e) {
      if (e instanceof NoResponse) setError("Could not reach Swathdeck — the geofence is unchanged");
      else if (!(e instanceof Stale)) throw e;
    }
  };
  return (
    <Dialog label="Edit geofence" onClose={onClose}>
      <h2>Edit geofence</h2>
      <div className="field">
        <label htmlFor="fence-edit">Geofence corners</label>
        <textarea id="fence-edit" className="vertices" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }} />
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void send()}>Save geofence</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

