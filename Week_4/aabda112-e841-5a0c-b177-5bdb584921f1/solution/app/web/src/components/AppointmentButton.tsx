import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { APPOINTMENT_STATUS_LABEL } from '../../../shared/domain';
import { useMotion } from '../lib/env';
import { hm } from '../lib/format';
import type { Appointment } from '../lib/types';
import { Avatar, Chip } from './ui';

export interface DropTarget {
  roomId: string;
  slot: number;
}

const LONG_PRESS_MS = 500;
const MOVE_PX = 8;

/** Where each appointment block last was, in grid coordinates, so a move from another window can glide. */
const lastPlace = new Map<string, { x: number; y: number; h: number }>();

const appointmentName = (a: Appointment): string =>
  `${a.patientName} with ${a.vetName}, ${hm(a.start)} to ${hm(a.end)}, ${APPOINTMENT_STATUS_LABEL[a.status]}${a.late ? ', late' : ''}`;

const REASON_TONE = { Consult: 'mint', Vaccination: 'sky', Surgery: 'rose' } as const;

interface Props {
  appointment: Appointment;
  slots: number;
  canMove: boolean;
  gridRef: React.RefObject<HTMLElement | null>;
  onOpen: (appointment: Appointment, opener: HTMLElement) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, appointment: Appointment) => void;
  onDrop: (appointment: Appointment, target: DropTarget | null) => void;
  inAgenda?: boolean;
}

/**
 * One appointment: a tinted card that is also a button. A mouse drags it; on touch a 500 ms press picks it up
 * (`data-picked`), dragging moves it and releasing drops it on the slot under the finger.
 */
export function AppointmentButton({ appointment: a, slots, canMove, gridRef, onOpen, onKey, onDrop, inAgenda }: Props) {
  const motion = useMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState(false);
  const pickedRef = useRef(false);
  const press = useRef<{ x: number; y: number; id: number; touch: boolean; timer?: number; dragging: boolean } | null>(null);
  const suppress = useRef(false);

  useLayoutEffect(() => {
    if (inAgenda) return;
    const el = ref.current!;
    const grid = gridRef.current;
    if (!grid) return;
    const box = el.getBoundingClientRect();
    const origin = grid.getBoundingClientRect();
    const now = { x: box.left - origin.left, y: box.top - origin.top, h: box.height };
    const before = lastPlace.get(a.id);
    lastPlace.set(a.id, now);
    if (!before || (before.x === now.x && before.y === now.y && before.h === now.h) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { transform: `translate(${before.x - now.x}px, ${before.y - now.y}px)`, height: `${before.h}px` },
        { transform: 'translate(0, 0)', height: `${now.h}px` },
      ],
      { duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  });

  useEffect(() => {
    const onTouchMove = (event: TouchEvent) => {
      if (pickedRef.current && event.cancelable) event.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);

  const finish = (event: PointerEvent<HTMLButtonElement> | null) => {
    const current = press.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    const el = ref.current!;
    const wasDrag = current.dragging || pickedRef.current;
    press.current = null;
    pickedRef.current = false;
    setPicked(false);
    el.style.transform = '';
    el.style.zIndex = '';
    el.style.pointerEvents = '';
    if (!wasDrag) return;
    suppress.current = true;
    if (!event) return;
    const under = document.elementsFromPoint(event.clientX, event.clientY).filter((n) => !el.contains(n));
    const cell = under.map((n) => n.closest<HTMLElement>('[role="gridcell"][data-room]')).find((n) => n !== null && n !== undefined);
    onDrop(a, cell ? { roomId: cell.dataset.room!, slot: Number(cell.dataset.slot) } : null);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    suppress.current = false;
    if (!canMove || inAgenda || event.button !== 0) return;
    const touch = event.pointerType === 'touch';
    const state = { x: event.clientX, y: event.clientY, id: event.pointerId, touch, dragging: false } as NonNullable<typeof press.current>;
    press.current = state;
    if (touch) {
      state.timer = window.setTimeout(() => {
        pickedRef.current = true;
        setPicked(true);
      }, LONG_PRESS_MS);
    } else {
      ref.current!.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const el = ref.current!;
    if (current.touch && !pickedRef.current) {
      if (Math.hypot(dx, dy) > MOVE_PX) {
        window.clearTimeout(current.timer);
        press.current = null;
      }
      return;
    }
    if (!current.touch && !current.dragging) {
      if (Math.hypot(dx, dy) < MOVE_PX) return;
      current.dragging = true;
    }
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.zIndex = '30';
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    onOpen(a, event.currentTarget);
  };

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      aria-label={appointmentName(a)}
      data-testid={`appt-${a.id}`}
      data-appt={a.id}
      data-picked={picked ? 'true' : undefined}
      className={`appt tint-${REASON_TONE[a.reason]} ${a.late ? 'is-late' : ''} ${inAgenda ? 'in-agenda' : ''}`}
      style={inAgenda ? undefined : { height: `calc(${slots} * var(--slot) - 4px)`, touchAction: canMove ? 'none' : undefined }}
      {...motion('appointment-move', 250, '0.2, 0, 0, 1')}
      onClick={onClick}
      onKeyDown={(event) => onKey(event, a)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={() => finish(null)}
      onContextMenu={(event) => {
        if (press.current?.touch) event.preventDefault();
      }}
    >
      <Avatar name={a.patientName} size={30} />
      <span className="appt-text">
        <span className="appt-patient">{a.patientName}</span>
        <span className="appt-meta">
          {a.vetName} · {hm(a.start)}–{hm(a.end)}
          {!inAgenda && slots < 2 && ` · ${a.reason}`}
        </span>
      </span>
      <span className="appt-chips">
        {(inAgenda || slots >= 2) && <Chip tone={REASON_TONE[a.reason]}>{a.reason}</Chip>}
        <Chip>{APPOINTMENT_STATUS_LABEL[a.status]}</Chip>
        {a.late && <Chip tone="rose">Late</Chip>}
      </span>
    </button>
  );
}
