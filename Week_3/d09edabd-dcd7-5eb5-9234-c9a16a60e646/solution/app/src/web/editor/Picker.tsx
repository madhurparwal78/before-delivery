import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, X } from '../ui/icons';
import { figureLine } from '../../shared/format';
import type { Room } from '../../shared/types';
import { Dialog } from '../ui/Dialog';
import { usePhone } from '../ui/hooks';
import { FloorPlan } from '../ui/FloorPlan';
import { ensureThumbnail, openRoom } from './rooms';
import { loadVersions } from './versions';
import { closeDialog, editor, openDialog, useEditor } from './state';
import { LogoMark } from './icons';

const BUILD = 'bench 1.0.0';

/** A card's picture; a room without a stored thumbnail is rendered once its card scrolls into view. */
function Thumb({ room }: { room: Room }) {
  const live = useEditor((s) => s.liveThumbs[room.id]);
  const webgl = useEditor((s) => s.webgl);
  const src = room.thumbnailUrl ?? live;
  const frame = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (src || seen || !frame.current) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true));
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [src, seen]);
  useEffect(() => {
    if (seen) void ensureThumbnail(room);
  }, [seen, room.id, room.thumbnailUrl]);
  if (src) return <img className="thumb" src={src} alt="" draggable={false} />;
  if (!webgl) return <div className="thumb plan"><FloorPlan dims={room} placements={[]} labels={false} label={`Plan of ${room.name}`} /></div>;
  return <div ref={frame} className="thumb placeholder" aria-hidden="true" />;
}

/** The Open a room dialog: a grid of room cards, arrow keys to move, Enter to walk in. */
export default function Picker() {
  const open = useEditor((s) => s.dialogs.picker === true);
  const rooms = useEditor((s) => s.rooms);
  const walkIn = useEditor((s) => s.walkIn);
  const [highlight, setHighlight] = useState(0);
  const phone = usePhone();
  const list = useRef<HTMLDivElement>(null);
  /** The picker that opens with the page gives focus to the Room stage when it closes. */
  const openedAtLoad = useRef(true);
  const columns = phone ? 2 : 4;
  const current = Math.min(highlight, Math.max(0, rooms.length - 1));

  useEffect(() => {
    if (open) setHighlight(0);
  }, [open]);

  const focused = useRef(false);
  useEffect(() => {
    if (!open) focused.current = false;
    else if (rooms.length > 0 && !focused.current) {
      focused.current = true;
      list.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
    }
  }, [open, rooms.length]);

  const pick = (room: Room): void => void openRoom(room.id, editor.get().walkIn);

  const move = (to: number): void => {
    const next = Math.max(0, Math.min(rooms.length - 1, to));
    setHighlight(next);
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, ArrowDown: current + columns, ArrowUp: current - columns, Home: 0, End: rooms.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      move(moves[event.key]!);
    } else if (event.key === 'Enter' && rooms[current]) {
      event.preventDefault();
      pick(rooms[current]!);
    }
  };

  const toggleWalk = (checked: boolean): void => {
    localStorage.setItem('kb-walk-in', String(checked));
    editor.set({ walkIn: checked });
  };

  const highlighted = rooms[current];
  const footerLink = (name: string, run: () => void) => (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault();
        run();
      }}
    >
      {name}
    </a>
  );

  return (
    <Dialog
      name="Open a room"
      open={open}
      onClose={() => closeDialog('picker')}
      className="picker centered"
      initialFocus={(root) => root.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')}
      returnFocus={() => {
        if (!openedAtLoad.current) return undefined;
        openedAtLoad.current = false;
        return document.querySelector<HTMLElement>('[data-stage]');
      }}
    >
      <div className="picker-head">
        <LogoMark size={32} />
        <div className="wordmark">
          <span className="name">
            <b>Keyway</b> <span>bench</span>
          </span>
          <span className="build mono">{BUILD}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog('picker')}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body picker-body">
        <div className="section-row">
          <ChevronLeft size={16} aria-hidden="true" />
          <h2>Pick a room</h2>
        </div>
        <p className="subtitle">Choose a draft or a starter room. Enter walks you in.</p>
        <div ref={list} role="listbox" aria-label="Rooms" className="card-grid" onKeyDown={onKeyDown}>
          {rooms.map((room, index) => (
            <div
              key={room.id}
              role="option"
              aria-selected={index === current}
              tabIndex={index === current ? 0 : -1}
              className="card"
              onMouseMove={() => setHighlight(index)}
              onClick={() => pick(room)}
            >
              <Thumb room={room} />
              <span className="strip">
                <b className="card-name">{room.name}</b>
                <span className="card-figures">{figureLine(room.stats)}</span>
              </span>
            </div>
          ))}
        </div>
        <a
          className="new-room"
          href="#new-room"
          onClick={(event) => {
            event.preventDefault();
            openDialog('newRoom');
          }}
        >
          New room
        </a>
        <div className="picker-footer">
          <label className="check">
            <input type="checkbox" checked={walkIn} onChange={(event) => toggleWalk(event.target.checked)} />
            <span>Walk in when I pick a room</span>
          </label>
          <nav className="footer-links">
            {footerLink('Prop library', () => openDialog('props'))}
            {footerLink('Versions', () => {
              if (!highlighted) return;
              void openRoom(highlighted.id, false).then(() => loadVersions());
              openDialog('versions');
            })}
            {footerLink('Keyboard shortcuts', () => openDialog('shortcuts'))}
          </nav>
        </div>
      </div>
    </Dialog>
  );
}
