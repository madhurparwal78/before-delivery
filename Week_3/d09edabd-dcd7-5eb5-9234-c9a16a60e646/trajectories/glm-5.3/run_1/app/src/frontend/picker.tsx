import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from '../shared/types.js';
import { cardFigures } from '../shared/index.js';
import { APP_VERSION } from '../shared/version.js';
import { COPY } from '../shared/copy.js';
import { renderThumbnail } from './stage3d.js';
import { fetchRoom } from './api.js';
import { Icon } from './ui.jsx';

export interface PickerActions {
  onOpenRoom: (roomId: string, walkIn: boolean) => void;
  onNewRoom: () => void;
  onPropLibrary: () => void;
  onVersions: () => void;
  onShortcuts: () => void;
  onClose: () => void;
}

/** The room picker dialog (DP-12, DP-13). */
export function RoomPicker(props: { rooms: Room[]; highlightedDefault?: boolean; actions: PickerActions; loading: boolean }): JSX.Element {
  const rooms = useMemo(() => [...props.rooms].sort((a, b) => {
    const x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }), [props.rooms]);
  const [highlight, setHighlight] = useState(0);
  const [walkIn, setWalkIn] = useState(() => {
    const v = localStorage.getItem('kb-walk-in');
    return v === null ? true : v === '1';
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => { setHighlight(0); }, [props.rooms.length]);

  // Opening moves focus to the highlighted card, once the cards exist.
  useEffect(() => {
    cardRefs.current[highlight]?.focus();
  }, [highlight, rooms.length > 0]);

  const columns = () => (window.innerWidth < 768 ? 2 : 4);

  const moveHighlight = (delta: number): void => {
    if (!rooms.length) return;
    setHighlight((h) => (h + delta + rooms.length) % rooms.length);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') { e.preventDefault(); moveHighlight(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(columns()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-columns()); }
    else if (e.key === 'Home') { e.preventDefault(); setHighlight(0); }
    else if (e.key === 'End') { e.preventDefault(); setHighlight(rooms.length - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const room = rooms[highlight];
      if (room) props.actions.onOpenRoom(room.id, walkIn);
    }
  };

  const setWalk = (v: boolean): void => {
    setWalkIn(v);
    localStorage.setItem('kb-walk-in', v ? '1' : '0');
  };

  return (
    <div className="scrim" onKeyDown={onKey}>
      <div ref={dialogRef} role="dialog" aria-label="Open a room" className="sheet dialog-open picker">
        <div className="sheet-head">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <span className="wordmark">Keyway <span className="light">bench</span></span>
          </div>
          <button className="cluster-btn" onClick={props.actions.onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="build-line mono">bench {APP_VERSION}</div>
        <div className="section">
          <button className="cluster-btn" style={{ minWidth: 36 }} aria-label="Back" disabled>
            <Icon name="chevron-left" />
          </button>
          <h2>Pick a room</h2>
        </div>
        <div className="subtitle">{COPY.pickRoomSubtitle}</div>
        <div className="grid" role="listbox" aria-label="Rooms">
          {rooms.map((room, i) => (
            <button
              key={room.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              role="option"
              aria-selected={i === highlight}
              className={`card${i === highlight ? ' selected' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => props.actions.onOpenRoom(room.id, walkIn)}
            >
              <RoomThumb room={room} />
              <span className="strip">
                <span className="name">{room.name}</span>
                <span className="figs">{cardFigures(room.stats)}</span>
              </span>
            </button>
          ))}
          {!rooms.length && <div className="muted" style={{ gridColumn: '1/-1', padding: '24px 0', textAlign: 'center' }}>{props.loading ? '' : COPY.emptyLibrary}</div>}
        </div>
        <div className="new-room">
          <a href="#" className="link-hit" onClick={(e) => { e.preventDefault(); props.actions.onNewRoom(); }}>New room</a>
        </div>
        <div className="footer">
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={walkIn}
              onChange={(e) => setWalk(e.target.checked)}
              aria-label="Walk in when I pick a room"
              style={{ width: 16, height: 16 }}
            />
            Walk in when I pick a room
          </label>
          <div className="links">
            <a href="#" className="link-hit" onClick={(e) => { e.preventDefault(); props.actions.onPropLibrary(); }}>Prop library</a>
            <a href="#" className="link-hit" onClick={(e) => { e.preventDefault(); props.actions.onVersions(); }}>Versions</a>
            <a href="#" className="link-hit" onClick={(e) => { e.preventDefault(); props.actions.onShortcuts(); }}>Keyboard shortcuts</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Room thumbnail rendered from the room's own primitives (DP-09), with MinIO copy when stored. */
export function RoomThumb(props: { room: Room; height?: number }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setReady(false);
    const load = async (): Promise<void> => {
      if (props.room.thumbnailUrl) {
        const r = await fetch(props.room.thumbnailUrl);
        if (r.ok && live) {
          const blob = await r.blob();
          setSrc(URL.createObjectURL(blob));
          setReady(true);
          return;
        }
      }
      const data = await renderThumbnailLive(props.room);
      if (live && data) { setSrc(data); setReady(true); }
    };
    void load();
    return () => { live = false; };
  }, [props.room.id, props.room.thumbnailUrl]);

  if (!ready) return <span className="thumb placeholder" aria-hidden="true" style={{ display: 'block' }} />;
  return <img className="thumb" src={src ?? undefined} alt="" />;
}

/** Render a thumbnail from the room's own primitives, using its stored placements. */
async function renderThumbnailLive(room: Room): Promise<string | null> {
  const detail = await fetchRoom(room.id).catch(() => null);
  if (!detail) return null;
  return renderThumbnail(room, detail.placements);
}
