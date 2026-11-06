import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from './live.js';
import { api, type Plan, type Scene, type Device, type Status } from './types.js';
import { FloorPlan, SceneLegend, Scrubber, Inspector, DeviceSheet } from './plancomp.js';
import { reducedMotion } from './sheet.js';
import { hhmm, longDate, pad, sinceCopy, abbrOfOffset, parseInstant, partsOf, addDays } from './time.js';

const PLAN_ORDER = ['hall', 'kitchen', 'living', 'study', 'main-bedroom', 'nursery', 'spare-room', 'bath', 'porch'];

interface PlanRoomState { sceneId: string | null; since: string | null; guestUntil: string | null }

export function PlanPage(): JSX.Element {
  const live = useLive();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [ownersAt, setOwnersAt] = useState<Map<string, PlanRoomState> | null>(null);
  const [displayed, setDisplayed] = useState<Map<string, string | null>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [planTimeMsg, setPlanTimeMsg] = useState('');
  const [deviceSheetFor, setDeviceSheetFor] = useState<Device | null>(null);
  const sweepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const roomBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Compute the scene of each room at instant t from the plan's changes.
  const ownersAtMinute = useCallback((p: Plan, day: string, minute: number, status: Status | null): Map<string, PlanRoomState> => {
    const startMs = parseInstant(p.start);
    const t = startMs + minute * 60_000;
    const out = new Map<string, PlanRoomState>();
    // Guest end instants keyed by guest scene id, for "guest until".
    const guestEnds = new Map<string, string>();
    for (const c of p.changes) {
      if (c.source === 'guest_end' && c.guest_scene_id) guestEnds.set(c.guest_scene_id, c.at);
    }
    for (const r of p.rooms) {
      let owner: PlanRoomState = { sceneId: null, since: null, guestUntil: null };
      const init = p.start_owners.find((o) => o.room_id === r.room_id);
      if (init && init.scene_id !== null) owner = { sceneId: init.scene_id, since: init.since, guestUntil: init.source === 'guest' && init.guest_scene_id ? (guestEnds.get(init.guest_scene_id) ?? null) : null };
      for (const c of p.changes) {
        if (parseInstant(c.at) > t) break;
        if (!c.room_ids.includes(r.room_id)) continue;
        if (c.source === 'guest') {
          owner = { sceneId: c.scene_id, since: c.at, guestUntil: guestEnds.get(c.guest_scene_id ?? '') ?? null };
        } else if (c.source === 'guest_end') {
          owner = { sceneId: c.scene_id, since: c.at, guestUntil: null };
        } else {
          owner = { sceneId: c.scene_id, since: c.at, guestUntil: null };
        }
      }
      out.set(r.room_id, owner);
    }
    void status; void day;
    return out;
  }, []);

  // Initial open: hub's today at hub's current minute, or the query string.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await api<{ now: string; day: string }>('/api/status');
      const params = new URLSearchParams(location.search);
      let d = status.day;
      let m: number | null = null;
      let fromQuery = false;
      if (params.get('day') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('day')!)) {
        d = params.get('day')!;
        fromQuery = true;
      }
      const atParam = params.get('at');
      if (atParam) {
        const mMatch = /^(\d{2}):(\d{2})/.exec(atParam);
        if (mMatch) m = Number(mMatch[1]) * 60 + Number(mMatch[2]);
      }
      if (m === null && fromQuery) m = 0;
      const [p, sc] = await Promise.all([
        api<{ plan: Plan }>(`/api/plan?day=${d}`).then((x) => x.plan).catch(() => null),
        api<{ scenes: Scene[] }>('/api/scenes'),
      ]);
      if (cancelled) return;
      setScenes(sc.scenes);
      if (p) {
        if (m === null) {
          const nowP = partsOf(status.now);
          m = nowP.h * 60 + nowP.mi;
        }
        if (status.day !== d) m = Math.min(m, (p.hours - 1) * 60 + 59);
        setPlan(p);
        setDay(d);
        setMinute(m);
        const owners = ownersAtMinute(p, d, m, null);
        setOwnersAt(owners);
        setDisplayed(new Map([...owners].map(([rid, o]) => [rid, o.sceneId])));
        setCounts(countOf(owners));
        writeAddress(d, m, p);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Refetch the plan when a schedule revision changes (someone saved a schedule).
  useEffect(() => {
    if (!live.scheduleRevs.size || !day) return;
    void (async () => {
      const fresh = await api<{ plan: Plan }>(`/api/plan?day=${day}`).then((x) => x.plan).catch(() => null);
      if (fresh) setPlan(fresh);
    })();
  }, [live.scheduleRevs, day]);

  // Refetch plan when the day changes.
  const setPlanDay = useCallback((d: string, keepWall: { hh: number; mi: number }) => {
    void (async () => {
      const fresh = await api<{ plan: Plan }>(`/api/plan?day=${d}`).then((x) => x.plan).catch(() => null);
      if (!fresh) return;
      // Keep wall time; nonexistent wall time means 03:00.
      let m = keepWall.hh * 60 + keepWall.mi;
      const exists = fresh.hour_marks.some((hm) => hm.label === pad(keepWall.hh)) || keepWall.hh !== 2 || fresh.hours === 24;
      if (!exists) m = 3 * 60;
      setPlan(fresh);
      setDay(d);
      scrubTo(fresh, m);
    })();
  }, []);

  const scrubTo = useCallback((p: Plan, m: number) => {
    setMinute(m);
    const owners = ownersAtMinute(p, p.day, m, live.status);
    setOwnersAt(owners);
    writeAddress(p.day, m, p);
    if (reducedMotion()) {
      setDisplayed(new Map([...owners].map(([rid, o]) => [rid, o.sceneId])));
      setCounts(countOf(owners));
    } else {
      runSweep(owners);
    }
    setPlanTimeMsg(planTimeCopy(scenes, owners, p, m));
  }, [ownersAtMinute, live.status, scenes]);

  // The signature sweep: changed rooms fill one by one in plan order.
  const runSweep = useCallback((target: Map<string, PlanRoomState>) => {
    for (const t of sweepTimers.current) clearTimeout(t);
    sweepTimers.current = [];
    const changed = PLAN_ORDER.filter((rid) => (displayedRef.current.get(rid) ?? null) !== (target.get(rid)?.sceneId ?? null));
    setDisplayed(new Map(displayedRef.current));
    changed.forEach((rid, i) => {
      const t = setTimeout(() => {
        setDisplayed((prev) => {
          const next = new Map(prev);
          next.set(rid, target.get(rid)?.sceneId ?? null);
          return next;
        });
        setCounts((prev) => {
          const next = new Map(prev);
          const left = displayedRef.current.get(rid) ?? null;
          if (left) next.set(left, (next.get(left) ?? 0) - 1);
          const joined = target.get(rid)?.sceneId ?? null;
          if (joined) next.set(joined, (next.get(joined) ?? 0) + 1);
          displayedRef.current = new Map([...displayedRef.current]).set(rid, joined);
          return next;
        });
      }, i * 40);
      sweepTimers.current.push(t);
    });
    // Also set final counts at the end for safety.
    const end = setTimeout(() => {
      setCounts(countOf(target));
    }, changed.length * 40 + 240);
    sweepTimers.current.push(end);
  }, []);

  const displayedRef = useRef<Map<string, string | null>>(new Map());
  useEffect(() => { displayedRef.current = displayed; }, [displayed]);

  const writeAddress = (d: string, m: number, p: Plan): void => {
    const endP = partsOf(p.end);
    // Minute m since day midnight. 24:00 means the following midnight.
    let hh = Math.floor(m / 60);
    const mi = m % 60;
    let offset: string;
    if (hh >= p.hours) { hh = 24; offset = endP.off; } else { offset = offsetForMinute(p, m); }
    const at = `${pad(hh)}:${pad(mi)}${offset}`;
    const url = `/plan?day=${d}&at=${at}`;
    history.replaceState(null, '', url);
  };

  const offsetForMinute = (p: Plan, m: number): string => {
    // Find the hour mark containing this minute; fall back to the day's start offset.
    if (m < 60) return partsOf(p.start).off;
    const hourIdx = Math.floor(m / 60);
    const marks = p.hour_marks;
    if (hourIdx < marks.length) {
      const markIso = marks[hourIdx]!;
      return partsOf(markIso.at).off;
    }
    return partsOf(p.end).off;
  };

  if (!plan || day === null || minute === null) {
    return <div className="page">Loading…</div>;
  }
  const planReady = plan;
  const dayNow = day;
  const minuteNow = minute;

  const isToday = live.status?.day === day;
  const nowMark = useMemo(() => {
    if (!isToday || !live.status) return null;
    const p = partsOf(live.status.now);
    const minutesSinceMidnight = p.h * 60 + p.mi;
    return { m: minutesSinceMidnight, label: `Now ${hhmm(live.status.now)}` };
  }, [isToday, live.status, plan]);

  const roomsList = plan.rooms;
  const sceneNameOf = (id: string | null): string => id === null ? 'Unplanned' : (scenes.find((s) => s.id === id)?.name ?? 'Unplanned');

  return (
    <div className="plan-page">
      <div className="plan-main-col">
        <section aria-label="Floor plan" className="floorplan-region">
          <FloorPlan plan={plan} displayed={displayed} sceneNameOf={sceneNameOf} onPick={(rid) => selectRoom(rid)} />
          <SceneLegend scenes={scenes} displayed={displayed} counts={counts} />
        </section>

        <section aria-label="Day and time" className="scrubber-block">
          <div className="dayline">{longDate(day)}{plan.hours !== 24 ? ` · ${plan.hours} hours` : ''}</div>
          <div className="day-controls">
            <button onClick={() => changeDay(-1)}>Previous day</button>
            <label>
              <span className="visually-hidden">Plan day</span>
              <input type="date" value={day} onChange={(e) => { if (e.target.value) setPlanDay(e.target.value, { hh: Math.floor(minute / 60), mi: minute % 60 }); }} aria-label="Plan day" />
            </label>
            <button onClick={() => changeDay(1)}>Next day</button>
            <button onClick={jumpToNow}>Jump to now</button>
          </div>
          <Scrubber plan={plan} minute={minute} onScrub={(m) => scrubTo(plan, m)} nowMark={nowMark} />
        </section>

        <div className="plan-two-col">
          <section aria-label="At this time" className="at-this-time">
            <h2>At this time</h2>
            <ul>
              {roomsList.map((r) => {
                const o = ownersAt?.get(r.room_id);
                const guest = o?.guestUntil;
                return (
                  <li key={r.room_id}>
                    {r.name} · {sceneNameOf(o?.sceneId ?? null)}
                    {guest ? ` · guest until ${hhmm(guest)}` : o?.since ? ` · since ${sinceCopy(o.since, day)}` : ''}
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-label="Rooms" className="room-list">
            <h2>Rooms</h2>
            <ul className="rooms-ul">
              {roomsList.map((r) => {
                const st = live.status?.rooms.find((x) => x.room_id === r.room_id);
                const guestRoom = live.guestScenes ? [...live.guestScenes.values()].find((g) => g.room_id === r.room_id && (g.state === 'scheduled' || g.state === 'active')) : undefined;
                return (
                  <li key={r.room_id}>
                    <button ref={(el) => { if (el) roomBtnRefs.current.set(r.room_id, el); }} className="room-btn" onClick={() => selectRoom(r.room_id)} aria-label={r.name}>
                      <span className="room-name">{r.name}</span>
                      <span className="room-now">Now: {st?.scene_name ?? 'Unplanned'}</span>
                      {guestRoom ? <span className="room-guest">Guest until {hhmm(guestRoom.ends_at)}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <div role="status" aria-live="polite" className="visually-hidden">{planTimeMsg}</div>
      </div>
      <Inspector
        room={selectedRoom}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        plan={plan}
        scenes={scenes}
        day={day}
        roomBtnRefs={roomBtnRefs}
        onDeviceSheet={setDeviceSheetFor}
      />
      <DeviceSheet device={deviceSheetFor} onClose={() => setDeviceSheetFor(null)} />
    </div>
  );

  function selectRoom(rid: string): void {
    setSelectedRoom(rid);
    setInspectorOpen(true);
  }

  function changeDay(delta: number): void {
    const next = addDays(dayNow, delta);
    setPlanDay(next, { hh: Math.floor(minuteNow / 60), mi: minuteNow % 60 });
  }

  function jumpToNow(): void {
    const st = live.status;
    if (!st) return;
    void (async () => {
      const fresh = st.day === dayNow ? planReady : await api<{ plan: Plan }>(`/api/plan?day=${st.day}`).then((x) => x.plan);
      const p = partsOf(st.now);
      setDay(st.day);
      setPlan(fresh);
      scrubTo(fresh, p.h * 60 + p.mi);
    })();
  }
}

function countOf(owners: Map<string, PlanRoomState>): Map<string, number> {
  const c = new Map<string, number>();
  for (const o of owners.values()) {
    if (o.sceneId) c.set(o.sceneId, (c.get(o.sceneId) ?? 0) + 1);
  }
  return c;
}

function planTimeCopy(scenes: Scene[], owners: Map<string, PlanRoomState>, p: Plan, m: number): string {
  const c = new Map<string, number>();
  let unplanned = 0;
  for (const o of owners.values()) {
    if (o.sceneId) c.set(o.sceneId, (c.get(o.sceneId) ?? 0) + 1);
    else unplanned++;
  }
  // Catalogue order for scenes that hold at least one room.
  const ordered = scenes.filter((s) => c.has(s.id));
  const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  // Inside a repeated hour the abbreviation is added.
  const hourIdx = Math.floor(m / 60);
  const marks = p.hour_marks;
  let repeatedAbbr = '';
  if (hourIdx >= 1 && hourIdx < marks.length && marks[hourIdx - 1]?.label === marks[hourIdx]?.label) {
    repeatedAbbr = ` ${abbrOfOffset(partsOf(marks[hourIdx]!.at).off)}`;
  }
  const parts: string[] = [];
  for (const s of ordered) {
    const n = c.get(s.id)!;
    parts.push(`${n} ${n === 1 ? 'room' : 'rooms'} in ${s.name}`);
  }
  if (unplanned > 0) parts.push(`${unplanned} ${unplanned === 1 ? 'room' : 'rooms'} unplanned`);
  return `At ${time}${repeatedAbbr}${parts.length ? ', ' + parts.join(', ') : ''}`;
}
