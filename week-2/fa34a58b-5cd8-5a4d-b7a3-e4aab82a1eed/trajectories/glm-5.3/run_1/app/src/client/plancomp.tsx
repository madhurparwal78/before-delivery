import { useEffect, useRef, useState } from 'react';
import type { Plan, Scene, Device } from './types.js';
import { useLive } from './live.js';
import { api, isApiFailure } from './types.js';
import { Sheet, reducedMotion } from './sheet.js';
import { hhmmss, pad, sinceCopy } from './time.js';

/** Fixed procedural layout of the nine rooms, drawn as an architect's plan. */
const LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  hall: { x: 4, y: 4, w: 14, h: 10 },
  living: { x: 4, y: 16, w: 22, h: 18 },
  study: { x: 4, y: 36, w: 22, h: 14 },
  kitchen: { x: 28, y: 4, w: 22, h: 22 },
  'main-bedroom': { x: 28, y: 28, w: 22, h: 16 },
  nursery: { x: 52, y: 4, w: 20, h: 20 },
  'spare-room': { x: 52, y: 26, w: 20, h: 18 },
  bath: { x: 28, y: 46, w: 22, h: 10 },
  porch: { x: 52, y: 46, w: 20, h: 10 },
};

const TINT_HEX: Record<string, string> = {
  candle: '#f2dca8',
  honey: '#e3b34c',
  amber: '#ffb347',
  rose: '#e8a87c',
  dusk: '#a87c4f',
  ember: '#b5622f',
};

export function FloorPlan(props: {
  plan: Plan;
  displayed: Map<string, string | null>;
  sceneNameOf: (id: string | null) => string;
  onPick: (roomId: string) => void;
}): JSX.Element {
  const { plan, displayed, sceneNameOf, onPick } = props;
  const VB_W = 76;
  const VB_H = 60;
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="floorplan" role="img">
      {plan.rooms.map((r) => {
        const box = LAYOUT[r.room_id];
        if (!box) return null;
        const sceneId = displayed.get(r.room_id) ?? null;
        const scene = sceneId ? sceneNameOf(sceneId) : 'Unplanned';
        return (
          <g key={r.room_id} className="roomshape" onClick={() => onPick(r.room_id)}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} className={sceneId ? 'room-rect room-filled' : 'room-rect'} data-room={r.room_id} />
            <title>{`${r.name}: ${scene}`}</title>
            <text x={box.x + 1.2} y={box.y + 4.2} className="room-label">{r.name}</text>
            <text x={box.x + 1.2} y={box.y + 7.4} className="room-scene">{scene}</text>
            {/* Dimension ticks: small perpendicular marks at wall ends. */}
            <line x1={box.x} y1={box.y} x2={box.x} y2={box.y - 1.4} className="dim-tick" />
            <line x1={box.x + box.w} y1={box.y} x2={box.x + box.w} y2={box.y - 1.4} className="dim-tick" />
            <line x1={box.x} y1={box.y + box.h} x2={box.x} y2={box.y + box.h + 1.4} className="dim-tick" />
            <line x1={box.x + box.w} y1={box.y + box.h} x2={box.x + box.w} y2={box.y + box.h + 1.4} className="dim-tick" />
            <text x={box.x + box.w / 2} y={box.y + box.h - 1} className="dim-label">{box.w}′</text>
          </g>
        );
      })}
    </svg>
  );
}

export function SceneLegend(props: { scenes: Scene[]; displayed: Map<string, string | null>; counts: Map<string, number> }): JSX.Element {
  const { scenes, displayed, counts } = props;
  const shown = new Map<string, number>();
  for (const sid of displayed.values()) {
    if (sid) shown.set(sid, counts.get(sid) ?? 0);
  }
  const list = scenes.filter((s) => shown.has(s.id) || counts.has(s.id));
  return (
    <ul className="scene-legend" aria-label="Scene legend">
      {list.map((s) => (
        <li key={s.id} className="legend-item">
          <span className="legend-swatch" style={{ background: TINT_HEX[s.tint] ?? '#333' }} />
          {s.name} <span className="mono">{counts.get(s.id) ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

export function Scrubber(props: {
  plan: Plan;
  minute: number;
  onScrub: (m: number) => void;
  nowMark: { m: number; label: string } | null;
}): JSX.Element {
  const { plan, minute, onScrub, nowMark } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const totalMin = plan.hours * 60;

  const pct = (m: number): number => (m / totalMin) * 100;

  const minuteFromPointer = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round((frac * totalMin) / 5) * 5;
  };

  const onKey = (e: React.KeyboardEvent): void => {
    let m = minute;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': m = minute + 15; break;
      case 'ArrowLeft': case 'ArrowDown': m = minute - 15; break;
      case 'PageUp': m = minute + 60; break;
      case 'PageDown': m = minute - 60; break;
      case 'Home': m = 0; break;
      case 'End': m = totalMin; break;
      default: return;
    }
    e.preventDefault();
    onScrub(Math.min(totalMin, Math.max(0, m)));
  };

  const markLabel = (i: number): string => {
    const hm = plan.hour_marks[i]!;
    if (plan.hours === 25 && i >= 1 && plan.hour_marks[i - 1]?.label === hm.label) return `${hm.label} ${hm.abbr}`;
    return hm.label;
  };

  const valuetext = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)} ${abbrFor(plan, minute)}`;

  return (
    <div className="scrubber">
      <div
        ref={trackRef}
        className="track"
        role="slider"
        tabIndex={0}
        aria-label="Time of day"
        aria-valuemin={0}
        aria-valuemax={totalMin}
        aria-valuenow={minute}
        aria-valuetext={valuetext}
        onKeyDown={onKey}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging(true); onScrub(minuteFromPointer(e.clientX)); }}
        onPointerMove={(e) => { if (dragging) onScrub(minuteFromPointer(e.clientX)); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="track-fill" style={{ width: `${pct(minute)}%` }} />
        {plan.hour_marks.map((_, i) => (
          <div key={i} className="hour-tick" style={{ left: `${pct((i * 60) + (plan.hours === 25 && i >= 2 ? 60 : 0))}%` }}>
            <span className="hour-label mono">{markLabel(i)}</span>
          </div>
        ))}
        {nowMark ? (
          <div className="now-marker" style={{ left: `${pct(nowMark.m)}%` }}>
            <span className="now-label mono">{nowMark.label}</span>
          </div>
        ) : null}
        <div className="thumb" style={{ left: `${pct(minute)}%` }} />
      </div>
    </div>
  );
}

function abbrFor(plan: Plan, minute: number): string {
  const hourIdx = Math.min(plan.hour_marks.length - 1, Math.floor(minute / 60));
  const mark = plan.hour_marks[hourIdx];
  return mark ? mark.abbr : 'CST';
}

export function Inspector(props: {
  room: string | null;
  open: boolean;
  onClose: () => void;
  plan: Plan;
  scenes: Scene[];
  day: string;
  roomBtnRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  onDeviceSheet: (d: Device) => void;
}): JSX.Element {
  const live = useLive();
  const { room, open, onClose, plan, day, roomBtnRefs, onDeviceSheet } = props;
  const [devices, setDevices] = useState<Device[]>([]);
  const wide = useMedia('(min-width: 1280px)');

  useEffect(() => {
    if (!room) return;
    void api<{ devices: Device[] }>(`/api/devices?room_id=${room}`).then((x) => setDevices(x.devices)).catch(() => {});
  }, [room, live.devices]);

  if (!room) return <></>;
  const st = live.status?.rooms.find((x) => x.room_id === room);
  const roomName = plan.rooms.find((r) => r.room_id === room)?.name ?? room;
  const planFor = plan.changes.filter((c) => c.room_ids.includes(room));

  const body = (
    <div className="inspector-body">
      <h2>{roomName}</h2>
      <p className="now-line">Now: {st?.scene_name ?? 'Unplanned'}{st?.since ? ` since ${sinceCopy(st.since, day)}` : ''}</p>
      <h3>Devices</h3>
      <ul className="devices-ul" aria-label="Devices">
        {(live.devices.size ? [...live.devices.values()].filter((d) => d.room_id === room) : devices).map((d) => (
          <DeviceRow key={d.id} device={d} onDetails={() => onDeviceSheet(d)} />
        ))}
      </ul>
      <h3>Plan for {roomName}</h3>
      <ul className="planfor-ul" aria-label={`Plan for ${roomName}`}>
        {planFor.map((c, i) => (
          <li key={i} className="mono">{c.local} {sceneNameById(props.scenes, c.scene_id)}</li>
        ))}
        {planFor.length === 0 ? <li className="dim">No changes today</li> : null}
      </ul>
    </div>
  );

  if (wide) {
    return (
      <aside className="inspector-col" aria-label="Room inspector">
        {body}
      </aside>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title="Room inspector" id="inspector-sheet"
      anchorRef={{ current: room ? roomBtnRefs.current?.get(room) ?? null : null }}>
      {body}
    </Sheet>
  );
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (): void => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

function sceneNameById(scenes: Scene[], id: string | null): string {
  return id === null ? 'Unplanned' : (scenes.find((s) => s.id === id)?.name ?? 'Unplanned');
}

export function DeviceRow(props: { device: Device; onDetails: () => void }): JSX.Element {
  const live = useLive();
  const d = live.devices.get(props.device.id) ?? props.device;
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  const [pulse, setPulse] = useState(false);
  const lastRev = useRef(d.revision);

  useEffect(() => {
    if (d.revision !== lastRev.current) {
      lastRev.current = d.revision;
      if (!reducedMotion()) {
        setPulse(true);
        setTimeout(() => setPulse(false), 450);
      }
    }
  }, [d.revision]);

  const setDevice = async (state: Record<string, unknown>): Promise<void> => {
    setPending(true);
    setErr('');
    try {
      await api(`/api/devices/${d.id}/state`, { method: 'PUT', body: JSON.stringify(state) });
    } catch (e) {
      if (isApiFailure(e)) setErr(e.error.message);
      else setErr("Nightplan can't reach the hub. Your last change was not saved.");
    } finally {
      setPending(false);
    }
  };

  const st = d.state as { on?: boolean; brightness?: number; setpoint_f?: number; current_f?: number };

  return (
    <li className={`device-row ${pulse ? 'pulse' : ''}`}>
      <span className="device-name">{d.name}</span>
      {d.kind === 'light' || d.kind === 'plug' ? (
        <>
          <button
            role="switch"
            aria-checked={!!st.on}
            aria-label={d.name}
            className="switch"
            disabled={pending}
            onClick={() => { void setDevice({ on: !st.on }); }}
          >
            <span className="switch-knob" />
          </button>
          {pending ? <span className="pending mono">Sending…</span> : null}
        </>
      ) : null}
      {d.kind === 'thermostat' ? (
        <span className="mono device-meta">Set to {st.setpoint_f}°F, reading {st.current_f}°F</span>
      ) : null}
      {d.kind === 'camera' ? <span className="device-meta">Camera</span> : null}
      <button className="btn-ghost" onClick={props.onDetails}>Details for {d.name}</button>
      {err ? <span className="inline-error" role="alert">{err}</span> : null}
    </li>
  );
}

export function DeviceSheet(props: { device: Device | null; onClose: () => void }): JSX.Element | null {
  const live = useLive();
  const { device, onClose } = props;
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  const anchor = useRef<HTMLButtonElement | null>(null);

  if (!device) return null;
  const d = live.devices.get(device.id) ?? device;
  const st = d.state as { on?: boolean; brightness?: number; setpoint_f?: number; current_f?: number };
  const lastReport = hhmmss(d.updated_at);

  const send = async (state: Record<string, unknown>): Promise<void> => {
    setPending(true);
    setErr('');
    try {
      await api(`/api/devices/${d.id}/state`, { method: 'PUT', body: JSON.stringify(state) });
    } catch (e) {
      if (isApiFailure(e)) setErr(e.error.message);
      else setErr("Nightplan can't reach the hub. Your last change was not saved.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet open={!!device} onClose={onClose} title={d.name} id="device-sheet" anchorRef={anchor}>
      <h2>{d.name}</h2>
      <p className="mono device-meta">{d.online ? 'Online' : 'Offline'} · Last report {lastReport}</p>
      {(d.kind === 'light' || d.kind === 'plug') ? (
        <label className="sheet-row">
          <span>Power</span>
          <button role="switch" aria-checked={!!st.on} aria-label="Power" className="switch" disabled={pending} onClick={() => { void send({ on: !st.on }); }}>
            <span className="switch-knob" />
          </button>
        </label>
      ) : null}
      {d.kind === 'light' ? (
        <label className="sheet-row">
          <span>Brightness</span>
          <input
            type="range" min={1} max={100} defaultValue={st.brightness ?? 1} aria-label="Brightness" className="slider"
            onKeyUp={(e) => { void send({ brightness: Number((e.target as HTMLInputElement).value) }); }}
            onPointerUp={(e) => { void send({ brightness: Number((e.target as HTMLInputElement).value) }); }}
            disabled={pending}
          />
        </label>
      ) : null}
      {d.kind === 'thermostat' ? (
        <label className="sheet-row">
          <span>Setpoint</span>
          <input
            type="number" min={60} max={80} defaultValue={st.setpoint_f ?? 68} aria-label="Setpoint" className="num"
            onKeyUp={(e) => { if (e.key === 'Enter') void send({ setpoint_f: Number((e.target as HTMLInputElement).value) }); }}
            onBlur={(e) => { void send({ setpoint_f: Number(e.target.value) }); }}
            disabled={pending}
          />
        </label>
      ) : null}
      {pending ? <span className="pending mono">Sending…</span> : null}
      {err ? <span className="inline-error" role="alert">{err}</span> : null}
      <button className="btn" onClick={onClose}>Close</button>
    </Sheet>
  );
}
