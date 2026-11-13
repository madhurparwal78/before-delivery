import { useEffect, useRef, useState } from 'react';
import type { Placement, Room, RoomDetail, Session } from '../shared/types.js';
import { mmss, lengthStr } from '../shared/index.js';
import type { Unit } from '../shared/units.js';
import { Icon } from './ui.jsx';

export function wrapDeg(d: number): number { return ((Math.round(d) % 360) + 360) % 360; }
export function clampPitch(p: number): number { return Math.min(80, Math.max(5, p)); }
export function clampInt(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, Math.round(v))); }

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export interface ChromeProps {
  me: { user: { id: string; displayName: string; role: 'owner' | 'co_designer' } };
  detail: RoomDetail;
  drawnPlacements: Placement[];
  drawnSceneOrder: string[];
  selected: Placement | null;
  selectedId: string | null;
  sim: { id: string; steps: number; y: number } | null;
  mode: 'move' | 'rotate' | 'scale';
  units: Unit;
  banner: string | null;
  valkeyDown: boolean;
  connectionCopy: string;
  playing: boolean;
  session: Session | null;
  remaining: number;
  presence: number;
  solves: Array<{ title: string; elapsedSeconds: number }>;
  cueOpen: boolean;
  holders: Record<string, string>;
  rotDraft: string | null;
  setRotDraft: (v: string | null) => void;
  setUnits: (u: Unit) => void;
  onCueToggle: () => void;
  onMode: (m: 'move' | 'rotate' | 'scale') => void;
  onPlay: () => void;
  onSheet: (s: string) => void;
  onPicker: () => void;
  onStepNode: () => void;
  onAddPrimitive: () => void;
  onSelect: (id: string) => void;
  onSceneMove: (id: string, dir: 'up' | 'down') => void;
  onRotCommit: (v: number) => void;
  onInvite: (email: string) => Promise<void>;
  playRef: React.RefObject<HTMLButtonElement>;
}

/** All floating chrome over the stage (top-left, pill, top-right, inspector, clusters, transport). */
export function EditorChrome(p: ChromeProps): JSX.Element {
  const isPhone = usePhone();
  const room = p.detail.room;
  return (
    <>
      {/* top-left */}
      <div className="cluster tl">
        <button className="cluster-btn" aria-label="Rooms" onClick={p.onPicker}>
          <Icon name="grid-3x3" size={20} />
        </button>
      </div>

      {/* session pill */}
      <div className="session-pill" role="toolbar" aria-label="Live session">
        <span className={`status-dot${p.valkeyDown ? ' paused' : ''}`} aria-hidden="true" />
        <span className="status-word">{p.valkeyDown ? 'Paused' : 'Live'}</span>
        <span className="conn-status tnum" role="status" aria-live="polite">{p.connectionCopy}</span>
        {p.banner ? (
          <span className="banner" role="status" aria-live="polite" aria-label="Service status">{p.banner}</span>
        ) : (
          <>
            <span className="room-code" aria-label="Room code">{room.id.slice(0, 6).toUpperCase()}</span>
            <button
              className="cluster-btn"
              style={{ minWidth: 36 }}
              aria-label="Copy room code"
              onClick={() => { void navigator.clipboard.writeText(room.id.slice(0, 6).toUpperCase()); }}
            >
              <Icon name="copy" size={14} />
            </button>
            {!isPhone && (
              <input
                aria-label="Invite tester email"
                placeholder="tester email"
                style={{ width: 140, background: 'var(--ground)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '0 8px', minHeight: 38 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const email = (e.target as HTMLInputElement).value;
                    if (email) void p.onInvite(email);
                  }
                }}
              />
            )}
            {!isPhone && <button className="cluster-btn" aria-label="Invite" onClick={() => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Invite tester email"]'); if (el?.value) void p.onInvite(el.value); }}>Invite</button>}
            <button className="cluster-btn" onClick={() => p.onSheet('playtests')}>Playtests</button>
            <button
              className="cluster-btn"
              aria-label="Session menu"
              aria-haspopup="menu"
              aria-expanded={false}
              onClick={() => p.onSheet('sessionmenu')}
            >
              <Icon name="settings" />
            </button>
          </>
        )}
      </div>

      {/* top-right */}
      <div className="cluster tr">
        {!isPhone && (
          <span role="group" aria-label="Chain figures" className="tnum" style={{ gap: 10, display: 'flex' }}>
            <span>{room.stats.solved} of {room.stats.total} solved</span>
            <span>Longest run {room.stats.longestRun}</span>
            <span>{room.stats.props === 1 ? '1 prop' : `${room.stats.props} props`}</span>
          </span>
        )}
        {isPhone && <span className="tnum">{room.stats.solved} of {room.stats.total} solved</span>}
        <button className="cluster-btn" aria-label="Presence">{p.presence} here</button>
        <button className="cluster-btn" aria-label="Account" style={{ borderRadius: '50%', background: 'var(--surface-raised)', fontWeight: 600 }}>
          {initials(p.me.user.displayName)}
        </button>
      </div>

      {/* inspector */}
      {p.selected && (
        <div className="inspector" role="region" aria-label="Inspector">
          <h3>{p.selected.label}</h3>
          <div className="line"><span>X</span><span className="tnum">{lengthStr(p.selected.xMm, p.units)}</span></div>
          <div className="line"><span>Y</span><span className="tnum">{lengthStr(p.sim?.id === p.selected.id ? p.sim.y : p.selected.yMm, p.units)}</span></div>
          <div className="line"><span>Z</span><span className="tnum">{lengthStr(p.selected.zMm, p.units)}</span></div>
          <div className="line"><span>Width</span><span className="tnum">{lengthStr(p.selected.widthMm, p.units)}</span></div>
          <div className="line"><span>Depth</span><span className="tnum">{lengthStr(p.selected.depthMm, p.units)}</span></div>
          <div className="line"><span>Height</span><span className="tnum">{lengthStr(p.selected.heightMm, p.units)}</span></div>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="insp-rot">Rotation</label>
            <input
              id="insp-rot"
              role="spinbutton"
              aria-label="Rotation"
              aria-valuenow={p.selected.rotationDeg}
              value={p.rotDraft ?? String(p.selected.rotationDeg)}
              onChange={(e) => p.setRotDraft(e.target.value)}
              onBlur={() => {
                const v = parseInt(p.rotDraft ?? '', 10);
                p.setRotDraft(null);
                if (Number.isNaN(v)) return;
                p.onRotCommit(v);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          </div>
        </div>
      )}

      {/* scene panel (desktop) */}
      {!isPhone && (
        <div className="scene-panel" role="region" aria-label="Scene">
          <SceneTree
            room={room}
            placements={p.drawnPlacements}
            order={p.drawnSceneOrder}
            selectedId={p.selectedId}
            onSelect={p.onSelect}
            onMove={p.onSceneMove}
            holders={p.holders}
            sim={p.sim}
          />
        </div>
      )}

      {/* bottom-left */}
      {!isPhone && (
        <div className="cluster bl">
          <button className="cluster-btn" aria-label="Add primitive" aria-haspopup="menu" onClick={p.onAddPrimitive}>
            <Icon name="plus" size={20} />
          </button>
          <button className="cluster-btn" aria-label="Upload prop" onClick={() => p.onSheet('library')}>
            <Icon name="upload" size={20} />
          </button>
        </div>
      )}

      {/* bottom-right */}
      {!isPhone && (
        <div className="cluster br">
          <button className="cluster-btn" aria-label="Cue timeline" aria-pressed={p.cueOpen} onClick={p.onCueToggle}>
            <Icon name="timer" size={20} />
          </button>
          <button
            className="cluster-btn"
            aria-label="Units"
            aria-pressed={p.units === 'ft'}
            onClick={() => p.setUnits(p.units === 'm' ? 'ft' : 'm')}
          >
            {p.units === 'm' ? 'm' : 'ft'}
          </button>
        </div>
      )}

      {/* cue strip */}
      {p.cueOpen && (
        <div className="cue-strip" role="region" aria-label="Cue timeline">
          {p.solves.length > 0
            ? p.solves.map((s, i) => <div key={i} className="item lit tnum">{mmss(s.elapsedSeconds)} {s.title}</div>)
            : p.detail.nodes.filter((n) => n.kind === 'lock' || n.kind === 'cue').map((n) => (
              <div key={n.id} className="item">{n.title}</div>
            ))}
        </div>
      )}

      {/* transport */}
      <div className="transport" role="toolbar" aria-label="Transport">
        {isPhone ? (
          <>
            <button className="cluster-btn slot" onClick={() => p.onSheet('toolsmenu')} aria-label="Tools" style={{ flexDirection: 'column', flex: 1, minHeight: 60 }}>
              <Icon name="settings" /><span style={{ fontSize: 10 }}>Tools</span>
            </button>
            <button className="cluster-btn slot" onClick={() => p.onSheet('graph')} aria-label="Graph" style={{ flexDirection: 'column', flex: 1, minHeight: 60 }}>
              <Icon name="layers" /><span style={{ fontSize: 10 }}>Graph</span>
            </button>
            <button ref={p.playRef} className="play-btn raised" aria-label={p.playing ? 'Stop playtest' : 'Start playtest'} onClick={p.onPlay}>
              <Icon name={p.playing ? 'square' : 'play'} size={p.playing ? 18 : 22} />
            </button>
            <button className="cluster-btn slot" onClick={() => p.onSheet('library')} aria-label="Props" style={{ flexDirection: 'column', flex: 1, minHeight: 60 }}>
              <Icon name="box" /><span style={{ fontSize: 10 }}>Props</span>
            </button>
            <button className="cluster-btn slot" onClick={p.onPicker} aria-label="Rooms" style={{ flexDirection: 'column', flex: 1, minHeight: 60 }}>
              <Icon name="grid-3x3" /><span style={{ fontSize: 10 }}>Rooms</span>
            </button>
          </>
        ) : (
          <>
            <button className="cluster-btn" aria-pressed={p.mode === 'move'} onClick={() => p.onMode('move')}>Move</button>
            <button className="cluster-btn" aria-pressed={p.mode === 'rotate'} onClick={() => p.onMode('rotate')}>Rotate</button>
            <button className="cluster-btn" aria-pressed={p.mode === 'scale'} onClick={() => p.onMode('scale')}>Scale</button>
            <span className="divider" />
            <button ref={p.playRef} className="play-btn" aria-label={p.playing ? 'Stop playtest' : 'Start playtest'} onClick={p.onPlay}>
              <Icon name={p.playing ? 'square' : 'play'} size={p.playing ? 18 : 22} />
            </button>
            <span className="divider" />
            <button className="cluster-btn" onClick={() => p.onSheet('graph')}>Trigger graph</button>
            <button className="cluster-btn" onClick={() => p.onSheet('library')}>Prop library</button>
            <button className="cluster-btn" onClick={p.onStepNode}>Next node</button>
            {p.session?.state === 'running' && (
              <span className="clock tnum" role="timer" aria-label="Playtest clock">{mmss(p.remaining)}</span>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Scene tree: one Tab stop with Alt+Arrow moves (DP-52). */
export function SceneTree(props: {
  room: Room;
  placements: Placement[];
  order: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  holders: Record<string, string>;
  sim: { id: string; steps: number; y: number } | null;
}): JSX.Element {
  const lastFocus = useRef<number>(0);
  return (
    <div
      role="tree"
      aria-label="Scene"
      tabIndex={0}
      onKeyDown={(e) => {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'));
        const idx = Math.min(items.length - 1, Math.max(0, lastFocus.current));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          const nextIdx = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? idx + 1 : idx - 1;
          const clamped = Math.min(items.length - 1, Math.max(0, nextIdx));
          lastFocus.current = clamped;
          items[clamped]?.focus();
        }
      }}
    >
      <div role="treeitem" aria-level={1} aria-expanded data-id={props.room.id} className={''} tabIndex={-1}>
        {props.room.name}
      </div>
      {props.order.map((id, i) => {
        const pl = props.placements.find((x) => x.id === id);
        if (!pl) return null;
        const holder = props.holders[id];
        const y = props.sim?.id === id ? props.sim.y : pl.yMm;
        return (
          <div
            key={id}
            role="treeitem"
            aria-level={2}
            aria-posinset={i + 1}
            aria-setsize={props.order.length}
            aria-description={holder ? `Locked by ${holder}` : undefined}
            tabIndex={-1}
            data-id={id}
            data-x-mm={String(pl.xMm)}
            data-y-mm={String(Math.round(y))}
            data-z-mm={String(pl.zMm)}
            data-rotation-deg={String(pl.rotationDeg)}
            data-sim-steps={props.sim?.id === id ? String(props.sim.steps) : undefined}
            className={props.selectedId === id ? 'selected' : ''}
            onClick={() => props.onSelect(id)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                e.stopPropagation();
                props.onMove(id, e.key === 'ArrowUp' ? 'up' : 'down');
              } else if (e.key === 'Enter') {
                e.preventDefault();
                props.onSelect(id);
              }
            }}
          >
            <Icon name={pl.kind === 'cylinder' ? 'cylinder' : pl.kind === 'door' ? 'door-open' : 'box'} size={14} />
            {pl.label}
          </div>
        );
      })}
    </div>
  );
}

/** Session menu / Tools menu. */
export function MenuPanel(props: {
  onClose: () => void;
  me: { user: { displayName: string } };
  variant?: 'session' | 'tools';
  onRun: (label: string) => void | Promise<void>;
}): JSX.Element {
  const items = props.variant === 'tools'
    ? ['Move', 'Rotate', 'Scale', 'Scene', 'Add primitive', 'Upload prop', 'Cue timeline', 'Units']
    : ['Freeze version', 'Versions', 'Prop library', 'Keyboard shortcuts', 'Sign out'];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); props.onClose(); }
    };
    ref.current?.addEventListener('keydown', onKey);
    return () => ref.current?.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="scrim" onClick={props.onClose}>
      <div
        ref={ref}
        role="menu"
        aria-label={props.variant === 'tools' ? 'Tools' : 'Session menu'}
        className="sheet dialog-open small"
        style={{ marginTop: 70, width: 260 }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((label) => (
          <button
            key={label}
            role="menuitem"
            className="cluster-btn"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => void props.onRun(label)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const on = (): void => setPhone(window.innerWidth < 768);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}
