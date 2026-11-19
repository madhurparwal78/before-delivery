import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { place, verticalNeighbour, type Placed } from "../../shared/masonry";
import type { FeedPin, Pin } from "../../shared/types";
import { armClickSuppression, beginPointerDrag, consumeClickSuppression, resolveDrop, type DropTarget } from "../lib/drag";
import { useExhibit } from "../lib/exhibit";
import { creditLine, imageSource } from "../lib/pins";

const subscribeResize = (listener: () => void): (() => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};
const useWindowWidth = (): number => useSyncExternalStore(subscribeResize, () => window.innerWidth);

const HOLD_MS = 500;
const SLOP_PX = 10;

export interface Selection {
  selected: ReadonlySet<number>;
  anchor: number | null;
  set: (ids: number[], anchor: number | null) => void;
  clear: () => void;
}

interface Props {
  name: string;
  pins: readonly (Pin | FeedPin)[];
  /** The section this grid shows, or null for the unsectioned area and for feeds. */
  sectionId?: number | null;
  showGroups?: boolean;
  selection?: Selection;
  onOpen: (pin: Pin, card: HTMLElement) => void;
  onSave: (pin: Pin, card: HTMLElement) => void;
  onReorder?: (pin: Pin, delta: -1 | 1) => void;
  onDropPin?: (pin: Pin, target: DropTarget) => void;
  /** Focus this card once it is rendered; a new nonce asks again. */
  focusRequest?: { id: number; nonce: number } | null;
}

export function Grid({ name, pins, sectionId = null, showGroups = false, selection, onOpen, onSave, onReorder, onDropPin, focusRequest }: Props) {
  const width = useWindowWidth();
  const layout = useMemo(() => place(pins.map((pin) => pin.image), width), [pins, width]);
  const exhibit = useExhibit();
  const cards = useRef(new Map<number, HTMLElement>());
  const [tabStop, setTabStop] = useState<number | null>(null);
  const lostFocus = useRef<number | null>(null);
  const [dropOver, setDropOver] = useState<number | null>(null);
  const editable = selection !== undefined;
  const effectiveStop = pins.some((pin) => pin.id === tabStop) ? tabStop : (pins[0]?.id ?? null);

  useLayoutEffect(() => {
    if (lostFocus.current !== null && document.activeElement === document.body) cards.current.get(lostFocus.current)?.focus({ preventScroll: true });
    lostFocus.current = null;
  });

  useLayoutEffect(() => {
    if (focusRequest) cards.current.get(focusRequest.id)?.focus({ preventScroll: true });
  }, [focusRequest]);

  useEffect(() => {
    if (tabStop !== null && !pins.some((pin) => pin.id === tabStop)) setTabStop(null);
  }, [pins, tabStop]);

  const focusIndex = (index: number): void => {
    const target = pins[Math.max(0, Math.min(pins.length - 1, index))];
    if (!target) return;
    cards.current.get(target.id)?.focus();
    setTabStop(target.id);
  };

  const rangeTo = (anchorId: number | null, toId: number): void => {
    if (!selection) return;
    const from = pins.findIndex((pin) => pin.id === anchorId);
    const to = pins.findIndex((pin) => pin.id === toId);
    if (to < 0) return;
    const start = from < 0 ? to : from;
    const [low, high] = start <= to ? [start, to] : [to, start];
    selection.set(pins.slice(low, high + 1).map((pin) => pin.id), from < 0 ? toId : anchorId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const card = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-pin-id]") : null;
    if (!card || event.target !== card) return;
    const index = Number(card.dataset["order"]);
    const pin = pins[index];
    if (!pin) return;
    const plain = !event.ctrlKey && !event.metaKey;
    if (event.altKey && plain && (event.key === "ArrowUp" || event.key === "ArrowDown") && onReorder) {
      event.preventDefault();
      onReorder(pin, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (!plain || event.altKey) return;
    const step = (to: number): void => {
      event.preventDefault();
      focusIndex(to);
      if (event.shiftKey && selection) rangeTo(selection.anchor ?? pin.id, pins[Math.max(0, Math.min(pins.length - 1, to))]?.id ?? pin.id);
    };
    switch (event.key) {
      case "ArrowRight":
        return step(index + 1);
      case "ArrowLeft":
        return step(index - 1);
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        return focusIndex(verticalNeighbour(layout.items, index, event.key === "ArrowDown"));
      case "Home":
        event.preventDefault();
        return focusIndex(0);
      case "End":
        event.preventDefault();
        return focusIndex(pins.length - 1);
      case "Enter":
        event.preventDefault();
        return onOpen(pin, card);
      case " ":
        if (!selection) return;
        event.preventDefault();
        if (selection.selected.has(pin.id)) selection.set([...selection.selected].filter((id) => id !== pin.id), pin.id);
        else selection.set([...selection.selected, pin.id], pin.id);
        return;
      case "Escape":
        if (selection && selection.selected.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        return;
      case "s":
      case "S":
        if (event.shiftKey) return;
        event.preventDefault();
        return onSave(pin, card);
    }
  };

  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const cancelHold = (): void => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, pin: Pin): void => {
    const card = event.currentTarget;
    consumeClickSuppression();
    if (event.pointerType === "touch") {
      cancelHold();
      const timer = window.setTimeout(() => {
        hold.current = null;
        armClickSuppression();
        card.focus({ preventScroll: true });
        onSave(pin, card);
      }, HOLD_MS);
      hold.current = { timer, x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0 || !onDropPin) return;
    beginPointerDrag(event, {
      source: card,
      onTarget: (hit) => {
        const over = hit?.closest<HTMLElement>("[data-pin-id]")?.dataset["pinId"];
        setDropOver(over === undefined ? null : Number(over));
      },
      onDrop: (hit) => {
        const target = resolveDrop(hit);
        if (target) onDropPin(pin, target);
      },
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const pending = hold.current;
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > SLOP_PX) cancelHold();
  };

  return (
    <div
      role="feed"
      aria-label={name}
      className={`grid${exhibit.open ? " grid--dim" : ""}`}
      data-columns={layout.columns}
      data-column-width={layout.columnWidth}
      data-section-id={sectionId === null ? "" : String(sectionId)}
      style={{ height: layout.height }}
      onKeyDown={onKeyDown}
    >
      {pins.map((pin, index) => {
        const placed = layout.items[index];
        if (!placed) return null;
        const selected = selection?.selected.has(pin.id) ?? false;
        const group = "group" in pin ? pin.group : null;
        return (
          <GridCard
            key={pin.id}
            pin={pin}
            placed={placed}
            order={index}
            credit={creditLine(pin)}
            groupSize={showGroups && group ? group.size : null}
            selectable={editable}
            selected={selected}
            tabStop={pin.id === effectiveStop}
            hidden={exhibit.hideCard && exhibit.cardId === pin.id}
            dropOver={dropOver === pin.id}
            register={(element) => {
              if (element) cards.current.set(pin.id, element);
              else cards.current.delete(pin.id);
            }}
            onFocus={() => setTabStop(pin.id)}
            onBlur={(event) => {
              if (event.relatedTarget === null) {
                lostFocus.current = pin.id;
                queueMicrotask(() => {
                  lostFocus.current = null;
                });
              }
            }}
            onClick={(event) => {
              if (consumeClickSuppression()) return;
              if (event.shiftKey && selection) {
                event.preventDefault();
                rangeTo(selection.anchor, pin.id);
                return;
              }
              onOpen(pin, event.currentTarget);
            }}
            onPointerDown={(event) => onPointerDown(event, pin)}
            onPointerMove={onPointerMove}
            onPointerEnd={cancelHold}
          />
        );
      })}
    </div>
  );
}

interface CardProps {
  pin: Pin | FeedPin;
  placed: Placed;
  order: number;
  credit: string;
  groupSize: number | null;
  selectable: boolean;
  selected: boolean;
  tabStop: boolean;
  hidden: boolean;
  dropOver: boolean;
  register: (element: HTMLElement | null) => void;
  onFocus: () => void;
  onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerEnd: () => void;
}

function GridCard({ pin, placed, order, credit, groupSize, selectable, selected, tabStop, hidden, dropOver, register, ...handlers }: CardProps) {
  const [broken, setBroken] = useState(false);
  const attributes: Record<string, string | number | undefined> = {
    "data-pin-id": pin.id,
    "data-order": order,
    "data-col": placed.col,
    "data-row": placed.row,
    "data-top": placed.top,
    "data-height": placed.height,
    "data-span": placed.span,
    "data-group-size": groupSize ?? undefined,
  };
  return (
    <article
      ref={register}
      {...attributes}
      {...(selectable ? { "aria-selected": selected, "data-selected": String(selected) } : {})}
      className={`card${selected ? " card--selected" : ""}${hidden ? " card--carried" : ""}${dropOver ? " card--drop" : ""}`}
      aria-label={`${pin.title}: ${pin.alt}`}
      tabIndex={tabStop ? 0 : -1}
      style={{ transform: `translate(${placed.left}px, ${placed.top}px)`, width: placed.width, height: placed.height }}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      onClick={handlers.onClick}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerEnd}
      onPointerCancel={handlers.onPointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="card-image" style={{ height: placed.imageHeight }}>
        {broken ? (
          <p className="image-unavailable">Image unavailable</p>
        ) : (
          <img src={imageSource(pin, placed.width)} alt={pin.alt} draggable={false} decoding="async" onError={() => setBroken(true)} />
        )}
        {selected ? (
          <span className="card-check" aria-hidden="true">
            <Check size={20} strokeWidth={2.5} />
          </span>
        ) : null}
      </div>
      <p className="card-title">{pin.title}</p>
      <p className="card-credit">{credit}</p>
    </article>
  );
}
