// The fleet board: alerts and vessel cards in the rail, every open mission on the chart, a vessel's detail.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, quietly, type Fix, type Line, type Mission, type MissionSummary, type Position, type Units, type Vessel } from "../api";
import { AlertsRegion } from "../components/AlertsRegion";
import { Chart, type ChartData } from "../components/Chart";
import { Sheet } from "../components/Dialog";
import { useFleetWatch } from "../components/fleetWatch";
import { VesselCards } from "../components/VesselCards";
import { useAnnouncer, usePoll, useTier } from "../hooks";
import { follow, navigate } from "../router";
import { useSession } from "../session";
import { hms, hours, interval, length, position, speed } from "../units";

const OPEN = new Set(["Planned", "Launched", "Surveying", "Recovering"]);

export function Fleet({ vesselId }: { vesselId: string | null }) {
  const { user } = useSession();
  const tier = useTier();
  const [lines, announce] = useAnnouncer();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [areas, setAreas] = useState<Record<string, Mission>>({});
  const [flagCount, setFlagCount] = useState<number | null>(null);
  const [replayAt, setReplayAt] = useState<Position | null>(null);
  const owners = useRef<Map<string, { id: string; name: string }> | null>(null);
  const statusOf = useCallback((id: string) => missions.find((m) => m.id === id)?.status, [missions]);
  const { vessels, alerts, applyAlert } = useFleetWatch({ announce, missionStatus: statusOf });

  usePoll(async () => {
    const result = await api<(MissionSummary & { owner_id: string; owner_name: string })[]>("/api/missions");
    if (!result.ok) return;
    const before = owners.current;
    const now = new Map(result.data.map((m) => [m.id, { id: m.owner_id, name: m.owner_name }]));
    if (before) {
      for (const m of result.data) {
        const previous = before.get(m.id);
        if (previous && previous.id !== m.owner_id && m.owner_id === user.id) announce(`${previous.name} handed ${m.name} to you`);
      }
    }
    owners.current = now;
    setMissions(result.data);
  }, 2000, []);

  // Survey areas of open missions, fetched once each (and refreshed now and then for geofence changes).
  const openIds = missions.filter((m) => OPEN.has(m.status)).map((m) => m.id).join(",");
  usePoll(async () => {
    const ids = openIds ? openIds.split(",") : [];
    const found: Record<string, Mission> = {};
    for (const id of ids) {
      const r = await api<Mission>(`/api/missions/${id}`);
      if (r.ok) found[id] = r.data;
    }
    setAreas(found);
  }, 30_000, [openIds]);

  usePoll(async () => {
    const r = await api<unknown[]>("/api/flags?state=open");
    if (r.ok) setFlagCount(r.data.length);
  }, 5000, []);

  const coverageOf = (missionId: string | null) => missions.find((m) => m.id === missionId)?.counters.coverage_pct ?? null;
  const selected = vessels?.find((v) => v.id === vesselId) ?? null;
  const open = (id: string) => navigate(`/fleet/${id}`);
  const close = () => navigate("/fleet");

  // Frame the missions on the water when there are any; otherwise every open mission.
  const active = Object.values(areas).filter((m) => m.status === "Launched" || m.status === "Surveying" || m.status === "Recovering");
  const chart: ChartData = {
    areas: (active.length ? active : Object.values(areas)).map((m) => ({ id: m.id, area: m.survey_area, fence: m.geofence })),
    markers: (vessels ?? []).flatMap((v) => {
      if (!v.last_fix) return [];
      const replaying = v.id === vesselId && replayAt;
      return [{ id: v.id, name: v.name, position: replaying ? replayAt : v.last_fix.position, heading: v.last_fix.heading_deg, replay: !!replaying }];
    }),
  };
  const lastShown = useRef<Vessel | null>(null);
  if (selected) lastShown.current = selected;
  const sheetVessel = selected ?? lastShown.current;

  const detail = vesselId && vessels && !selected ? <p>That vessel does not exist.</p>
    : sheetVessel ? <VesselDetail key={sheetVessel.id} vessel={sheetVessel} missions={missions} announce={announce} coverage={coverageOf(sheetVessel.mission_id)} onReplay={setReplayAt} /> : null;

  return (
    <main className="console-main">
      <div className={`console no-head ${tier}`}>
        <aside className="rail">
          <div className="rail-section">
            <div className="announce" role="status" aria-live="polite" aria-label="Fleet announcements">
              {lines.map((l, i) => <p key={`${i}-${l}`}>{l}</p>)}
            </div>
            {/* Held at the link's height before the count arrives, so the chart below never moves. */}
            <p className="flags-link">
              {flagCount !== null && <a href="/flags" onClick={(e) => { e.preventDefault(); follow("/flags"); }}>Client flags ({flagCount})</a>}
            </p>
          </div>
          {tier !== "narrow" && <AlertsRegion alerts={alerts} loaded={vessels !== null} announce={announce} applyAlert={applyAlert} />}
          {tier !== "narrow" && vessels && <VesselCards vessels={vessels} coverageOf={coverageOf} selected={vesselId} onOpen={open} />}
        </aside>
        <div className="centre">
          <Chart data={chart} units={user.units} />
          {tier === "narrow" && (
            <div className="list-under">
              <AlertsRegion alerts={alerts} loaded={vessels !== null} announce={announce} applyAlert={applyAlert} />
              {vessels && <VesselCards vessels={vessels} coverageOf={coverageOf} selected={vesselId} onOpen={open} />}
            </div>
          )}
        </div>
        {tier === "wide" && (
          <section className="detail-pane" aria-labelledby="detail-heading">
            <h2 id="detail-heading" className="sr-only">Detail</h2>
            {selected ? detail : <p className="muted">Select a vessel</p>}
          </section>
        )}
      </div>
      {tier !== "wide" && (
        <Sheet open={!!selected} label={`${sheetVessel?.name ?? "Vessel"} detail`} onClose={close} full={tier === "narrow"}>
          {detail}
        </Sheet>
      )}
    </main>
  );
}

interface DetailProps {
  vessel: Vessel;
  missions: MissionSummary[];
  coverage: number | null;
  announce: (text: string) => void;
  onReplay: (at: Position | null) => void;
}

function VesselDetail({ vessel, missions, coverage, announce, onReplay }: DetailProps) {
  const { user } = useSession();
  const [recent, setRecent] = useState<(Fix & { received_at: string })[]>([]);
  const [window600, setWindow600] = useState<Fix[]>([]);
  const [lineLabel, setLineLabel] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  const mission = missions.find((m) => m.id === vessel.mission_id) ?? null;

  usePoll(async () => {
    const [a, b] = await Promise.all([
      api<(Fix & { received_at: string })[]>(`/api/vessels/${vessel.id}/fixes`),
      api<Fix[]>(`/api/vessels/${vessel.id}/fixes?window_s=600`),
    ]);
    if (a.ok) setRecent(a.data);
    if (b.ok) setWindow600(b.data);
    if (vessel.running_line_id && vessel.mission_id) {
      const l = await api<Line[]>(`/api/missions/${vessel.mission_id}/lines`);
      if (l.ok) setLineLabel(l.data.find((x) => x.id === vessel.running_line_id)?.label ?? null);
    } else setLineLabel(null);
  }, 2000, [vessel.id, vessel.last_fix?.t, vessel.running_line_id]);

  const latestT = vessel.last_fix ? Date.parse(vessel.last_fix.t) : null;
  const replayFix = (() => {
    if (!replay || latestT === null || !window600.length) return null;
    const at = latestT + replay * 1000;
    return window600.find((f) => Date.parse(f.t) <= at) ?? window600[window600.length - 1];
  })();
  const replayPosition = replayFix?.position ?? null;
  useEffect(() => {
    onReplay(replayPosition);
  }, [replayPosition?.easting, replayPosition?.northing]);
  useEffect(() => () => onReplay(null), [onReplay]);

  return (
    <div className="vessel-detail">
      <h2>{vessel.name}</h2>
      <dl className="facts">
        <dt>Link state</dt><dd className="state-word">{vessel.link_state}</dd>
        <dt>Position</dt>
        <dd className="num">{replayFix ? `Replay ${position(replayFix.position, user.units)} · ${hms(replayFix.t)} UTC`
          : vessel.last_fix ? position(vessel.last_fix.position, user.units) : "No fix yet"}</dd>
        <dt>Speed</dt><dd className="num">{vessel.last_fix ? speed(vessel.last_fix.speed_mps, user.units) : "—"}</dd>
        <dt>Battery</dt><dd className="num">{vessel.last_fix ? `${vessel.last_fix.battery_pct} %` : "—"}</dd>
        <dt>Depth</dt><dd className="num">{vessel.last_fix ? length(vessel.last_fix.depth_m, user.units) : "—"}</dd>
        <dt>Current line</dt><dd>{lineLabel ?? "None"}</dd>
        <dt>Mission</dt><dd>{mission?.name ?? "None"}</dd>
        <dt>Coverage</dt><dd className="num">{coverage === null ? "—" : `${coverage}%`}</dd>
        <dt>Since service</dt><dd className="num">{hours(vessel.hours_since_service)} of {interval(vessel.service_interval_h)}</dd>
        <dt>Slipway</dt><dd>{vessel.afloat ? "Afloat" : "Ashore"}</dd>
      </dl>
      {vessel.service_overdue && <p className="overdue-note">Service overdue</p>}
      {user.role === "principal_surveyor"
        ? <IntervalField vessel={vessel} announce={announce} />
        : <p>Service interval <span className="num">{interval(vessel.service_interval_h)}</span></p>}
      <div className="section">
        <label htmlFor="replay">Track replay</label>
        <div className="row">
          <input id="replay" type="range" min={-600} max={0} step={10} value={replay}
            aria-valuetext={replay ? `${-replay} s ago` : "Now"} onChange={(e) => setReplay(Number(e.target.value))} />
          <span className="num">{replay ? `${-replay} s ago` : "Now"}</span>
        </div>
      </div>
      <h3>Recent fixes</h3>
      <RecentFixes fixes={recent} units={user.units} />
    </div>
  );
}

function IntervalField({ vessel, announce }: { vessel: Vessel; announce: (text: string) => void }) {
  const [value, setValue] = useState(String(vessel.service_interval_h));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const version = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty) setValue(String(vessel.service_interval_h));
  }, [vessel.service_interval_h, dirty]);

  const save = async () => {
    const sent = version.current ?? vessel.version;
    announce("Saving interval");
    const result = await api<Vessel & { current?: Vessel }>(`/api/vessels/${vessel.id}`, {
      method: "PATCH", body: { service_interval_h: Number(value), version: sent },
    });
    if (result.ok) {
      version.current = null;
      setDirty(false);
      setCurrent(null);
      setError(null);
      announce(`Service interval saved for ${vessel.name}`);
    } else if (result.error?.error === "stale_version") {
      const latest = result.error.current as Vessel;
      version.current = latest.version;
      setCurrent(latest.service_interval_h);
      announce(result.error.message);
    } else if (result.error?.errors) {
      setError(result.error.errors.service_interval_h ?? result.error.message);
    }
  };

  return (
    <form className="field section" onSubmit={(e) => { e.preventDefault(); quietly(save()); }}>
      <label htmlFor="interval">Service interval</label>
      <div className="with-unit">
        <input id="interval" type="number" step="0.1" min={50} max={1000} value={value} onChange={(e) => {
          if (!dirty && version.current === null) version.current = vessel.version;
          setDirty(true);
          setValue(e.target.value);
        }} />
        <span className="unit">h</span>
        {current !== null && <span className="num">Current: {interval(current)}</span>}
      </div>
      {error && <p className="field-error">{error}</p>}
      <button type="submit">Save interval</button>
    </form>
  );
}

/** Recent fixes, newest first; a focused row keeps focus, and a scrolled list keeps what is in view. */
function RecentFixes({ fixes, units }: { fixes: (Fix & { received_at: string })[]; units: Units }) {
  const list = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!focused || fixes.some((f) => f.t === focused)) return;
    const last = fixes[fixes.length - 1];
    if (last) {
      setFocused(last.t);
      list.current?.querySelector<HTMLElement>(`[data-t="${last.t}"]`)?.focus();
    }
  }, [fixes, focused]);
  const tabbable = focused && fixes.some((f) => f.t === focused) ? focused : fixes[0]?.t;
  return (
    <ul ref={list} className="recent" aria-label="Recent fixes" onKeyDown={(e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = fixes.findIndex((f) => f.t === focused);
      const next = fixes[Math.max(0, Math.min(fixes.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) list.current?.querySelector<HTMLElement>(`[data-t="${next.t}"]`)?.focus();
    }}>
      {fixes.map((f) => (
        <li key={f.t} data-t={f.t} tabIndex={f.t === tabbable ? 0 : -1} onFocus={() => setFocused(f.t)}>
          {hms(f.t)} UTC · {position(f.position, units)} · <span className="value">{speed(f.speed_mps, units)}</span>
        </li>
      ))}
    </ul>
  );
}
