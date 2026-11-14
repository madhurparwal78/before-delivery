import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bay, Position, StripView } from '../../shared/types.js';
import { BOARD_BAYS, BOARD_NAMES } from '../../shared/types.js';

export interface BoardActions {
  forward(copy: StripView): void;
  back(copy: StripView): void;
  drop(copy: StripView, bay: Bay): void;
  edit(copy: StripView): void;
  notOnFrequency(copy: StripView): void;
  focusCommand(): void;
  select(callsign: string | null): void;
}

export interface BoardProps {
  position: Position;
  strips: StripView[];
  canAct: boolean;
  pending: Set<string>;
  previewCallsign: string | null;
  reducedMotion: boolean;
  flashKey: number;
  actions: BoardActions;
}

const copyKey = (strip: StripView) => `${strip.callsign}:${strip.board}:${strip.state === 'transferred' ? 'transferred' : 'live'}`;

function stripLabel(strip: StripView): string {
  const where = strip.kind === 'DEP' ? `stand ${strip.stand ?? ''}` : `runway ${strip.runway ?? ''}`;
  const hold = strip.holdingPoint ? `holding point ${strip.holdingPoint}` : 'no holding point';
  const label = `${strip.callsign}, ${strip.kind}, ${strip.type}, wake ${strip.wake}, ${strip.rules}, ${where}, ${hold}, cleared ${strip.cleared ?? 'none'}`;
  return strip.state === 'transferred' ? `${label}, transferred to Tower` : label;
}

function mark(element: Element, attribute: string, value: string, ms: number): void {
  element.setAttribute(attribute, value);
  setTimeout(() => {
    if (element.getAttribute(attribute) === value) element.removeAttribute(attribute);
  }, ms);
}

/** One drag in progress: the strip follows the pointer until it is dropped on a bay. */
interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

function StripItem(props: {
  strip: StripView;
  tabbable: boolean;
  pending: boolean;
  preview: boolean;
  canAct: boolean;
  actions: BoardActions;
  onFocusStrip(key: string): void;
  onNavigate(event: KeyboardEvent, key: string): void;
}) {
  const { strip, actions } = props;
  const drag = useRef<Drag | null>(null);
  const transferred = strip.state === 'transferred';
  const key = copyKey(strip);
  return (
    <li
      data-strip={strip.callsign}
      data-bay={strip.bay}
      data-frequency={strip.frequency}
      data-state={strip.state}
      data-version={String(strip.version)}
      data-pending={props.pending ? 'true' : undefined}
      data-preview={props.preview ? 'true' : undefined}
      data-emergency={strip.emergency ? 'true' : undefined}
      data-key={key}
      data-kind={strip.kind}
      aria-label={stripLabel(strip)}
      aria-disabled={transferred ? 'true' : undefined}
      tabIndex={props.tabbable ? 0 : -1}
      class="strip"
      onFocus={() => props.onFocusStrip(key)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.ctrlKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
          event.preventDefault();
          if (!props.canAct) return;
          if (transferred) actions.notOnFrequency(strip);
          else if (event.key === 'ArrowRight') actions.forward(strip);
          else actions.back(strip);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!props.canAct) return;
          if (transferred) actions.notOnFrequency(strip);
          else actions.edit(strip);
          return;
        }
        props.onNavigate(event, key);
      }}
      onPointerDown={(event) => {
        if (!props.canAct || transferred || (event.pointerType === 'mouse' && event.button !== 0)) return;
        if ((event.target as Element).closest('button')) return;
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.startX;
        const dy = event.clientY - current.startY;
        if (!current.moved && Math.hypot(dx, dy) < 6) return;
        current.moved = true;
        event.currentTarget.classList.add('dragging');
        event.currentTarget.style.transform = `translate(${dx}px, ${dy}px)`;
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        drag.current = null;
        const element = event.currentTarget;
        element.classList.remove('dragging');
        element.style.transform = '';
        if (!current || !current.moved) return;
        const target = document
          .elementsFromPoint(event.clientX, event.clientY)
          .map((el) => el.closest<HTMLElement>('[data-bay-target]'))
          .find((el) => el && el.dataset.board === strip.board);
        const bay = target?.dataset.bayTarget as Bay | undefined;
        if (bay && bay !== strip.bay) actions.drop(strip, bay);
      }}
      onPointerCancel={(event) => {
        drag.current = null;
        event.currentTarget.classList.remove('dragging');
        event.currentTarget.style.transform = '';
      }}
    >
      <span class="strip-row">
        <span class="strip-callsign">{strip.callsign}</span>
        <span class="strip-kind">{strip.kind}</span>
        <span>{strip.type}</span>
        <span>{strip.wake}</span>
        <span>{strip.rules}</span>
        <span>{strip.kind === 'DEP' ? strip.stand : `RWY ${strip.runway ?? ''}`}</span>
        {strip.holdingPoint ? <span>HP {strip.holdingPoint}</span> : null}
      </span>
      <span class="strip-row">
        <span class="strip-cleared mono">{strip.cleared ?? 'No clearance'}</span>
        {strip.goAround ? <span class="strip-tag">GO AROUND</span> : null}
        {transferred ? <span class="strip-tag">TRANSFERRED</span> : null}
        {strip.remarks ? <span class="muted">{strip.remarks}</span> : null}
      </span>
      {strip.emergency ? <span class="strip-band">EMERGENCY</span> : null}
      {strip.timers.length > 0 ? (
        <span class="strip-row timers">
          {strip.timers.map((timer) => (
            <span key={timer.kind} data-timer={timer.kind} data-near={timer.near ? 'true' : undefined} class="timer tabular">
              {timer.text}
            </span>
          ))}
        </span>
      ) : null}
      {props.canAct && strip.state === 'offered' && strip.bay === 'Incoming' ? (
        <button type="button" tabIndex={-1} class="strip-button" onClick={() => actions.forward(strip)}>
          {`Accept ${strip.callsign}`}
        </button>
      ) : null}
      {props.canAct && strip.state === 'offered' && strip.bay === 'Hand-off' ? (
        <button type="button" tabIndex={-1} class="strip-button" onClick={() => actions.back(strip)}>
          {`Recall ${strip.callsign}`}
        </button>
      ) : null}
    </li>
  );
}

export function Board(props: BoardProps) {
  const bays = BOARD_BAYS[props.position];
  const name = BOARD_NAMES[props.position];
  const mine = props.strips.filter((strip) => strip.board === props.position);
  const byBay = new Map<Bay, StripView[]>(bays.map((bay) => [bay, mine.filter((strip) => strip.bay === bay)]));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const region = useRef<HTMLElement>(null);
  const previous = useRef<{ bays: Map<string, string>; rects: Map<string, DOMRect>; first: boolean }>({
    bays: new Map(),
    rects: new Map(),
    first: true,
  });

  const keys = mine.map(copyKey);
  const firstKey = bays.map((bay) => byBay.get(bay)![0]).find(Boolean);
  const rovingKey = focusKey && keys.includes(focusKey) ? focusKey : firstKey ? copyKey(firstKey) : null;

  useLayoutEffect(() => {
    const root = region.current;
    if (!root) return;
    const memory = previous.current;
    const nextBays = new Map<string, string>();
    const nextRects = new Map<string, DOMRect>();
    let focusLost = false;
    for (const element of root.querySelectorAll<HTMLElement>('li[data-key]')) {
      const key = element.dataset.key!;
      const bay = element.dataset.bay!;
      const rect = element.getBoundingClientRect();
      nextBays.set(key, bay);
      nextRects.set(key, rect);
      if (memory.first) continue;
      const before = memory.bays.get(key);
      if (before === undefined) {
        if (props.reducedMotion) continue;
        element.classList.add('strip-enter');
        setTimeout(() => element.classList.remove('strip-enter'), 250);
        if (bay === 'Incoming') mark(element, 'data-motion', 'pulse', 1200);
      } else if (before !== bay) {
        if (props.reducedMotion) continue;
        mark(element, 'data-motion', 'move', 250);
        const old = memory.rects.get(key);
        if (old && typeof element.animate === 'function') {
          element.animate(
            [{ transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 250, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
          );
        }
      }
    }
    if (!memory.first && props.reducedMotion) {
      for (const element of root.querySelectorAll<HTMLElement>('li[data-key]')) {
        if (memory.bays.get(element.dataset.key!) === undefined && element.dataset.bay === 'Incoming') {
          mark(element, 'data-outline', 'static', 2000);
        }
      }
    }
    if (focusKey && document.activeElement === document.body && memory.bays.has(focusKey)) focusLost = true;
    if (focusLost) {
      const callsign = focusKey!.split(':')[0];
      const target =
        root.querySelector<HTMLElement>(`li[data-key="${focusKey}"]`) ?? root.querySelector<HTMLElement>(`li[data-strip="${callsign}"]`);
      target?.focus({ preventScroll: true });
    }
    previous.current = { bays: nextBays, rects: nextRects, first: false };
  });

  useLayoutEffect(() => {
    if (props.flashKey === 0 || !region.current) return;
    mark(region.current, props.reducedMotion ? 'data-outline' : 'data-motion', props.reducedMotion ? 'static' : 'flash', props.reducedMotion ? 2000 : 600);
  }, [props.flashKey]);

  const navigate = (event: KeyboardEvent, key: string) => {
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!arrows.includes(event.key) || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const filled = bays.filter((bay) => byBay.get(bay)!.length > 0);
    const bayIndex = filled.findIndex((bay) => byBay.get(bay)!.some((strip) => copyKey(strip) === key));
    const list = byBay.get(filled[bayIndex]!)!;
    const index = list.findIndex((strip) => copyKey(strip) === key);
    let next: StripView | undefined;
    if (event.key === 'ArrowUp') next = list[Math.max(0, index - 1)];
    if (event.key === 'ArrowDown') next = list[Math.min(list.length - 1, index + 1)];
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const target = filled[bayIndex + (event.key === 'ArrowRight' ? 1 : -1)];
      if (target) {
        const other = byBay.get(target)!;
        next = other[Math.min(index, other.length - 1)];
      }
    }
    if (next) {
      region.current?.querySelector<HTMLElement>(`li[data-key="${copyKey(next)}"]`)?.focus();
    }
  };

  return (
    <section
      ref={region}
      aria-label={name}
      class="board"
      data-board={props.position}
      onKeyDown={(event) => {
        if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          props.actions.focusCommand();
        }
      }}
    >
      <h2 class="board-title">{name}</h2>
      <div class="bays" style={{ '--bay-count': String(bays.length) }}>
        {bays.map((bay) => {
          const list = byBay.get(bay)!;
          return (
            <div key={bay} class="bay" data-bay-target={bay} data-board={props.position}>
              <h3 class="bay-title">{bay}</h3>
              <ul aria-label={bay} class="strip-list">
                {list.map((strip) => (
                  <StripItem
                    key={copyKey(strip)}
                    strip={strip}
                    tabbable={copyKey(strip) === rovingKey}
                    pending={props.pending.has(strip.callsign) && strip.state !== 'transferred'}
                    preview={props.previewCallsign === strip.callsign && strip.state !== 'transferred'}
                    canAct={props.canAct}
                    actions={props.actions}
                    onFocusStrip={(key) => {
                      setFocusKey(key);
                      props.actions.select(key.split(':')[0]!);
                    }}
                    onNavigate={navigate}
                  />
                ))}
              </ul>
              {list.length === 0 ? <p class="empty">No strips here.</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
