import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { bulletLabel } from "../../shared/text";
import type { Bullet } from "../../shared/types";
import { PLACEHOLDER_TEXT } from "../../shared/copy";
import type { ControllerState, OutlineController } from "./controller";
import { RichText } from "./rich";

const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 8;
const DRAG_START_PX = 4;

interface Drag {
  id: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

function dropTarget(x: number, y: number, carried: string): { container: string; index: number } | null {
  const columns = [...document.querySelectorAll<HTMLElement>("[data-column]")];
  let best: HTMLElement | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const column of columns) {
    const rect = column.getBoundingClientRect();
    const away = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (away < distance) {
      distance = away;
      best = column;
    }
  }
  const container = best?.dataset.column;
  if (best === undefined || container === undefined) return null;
  const cards = [...best.querySelectorAll<HTMLElement>("[data-card]")].filter((card) => card.dataset.bulletId !== carried);
  let index = cards.length;
  for (let at = 0; at < cards.length; at += 1) {
    const rect = cards[at]?.getBoundingClientRect();
    if (rect !== undefined && y < rect.top + rect.height / 2) {
      index = at;
      break;
    }
  }
  return { container, index };
}

function Card({ bullet, controller, carried, onPointerDown }: {
  bullet: Bullet;
  controller: OutlineController;
  carried: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLLIElement>, bullet: Bullet) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const text = controller.textOf(bullet);

  useEffect(() => {
    if (carried) ref.current?.focus();
  }, [carried]);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    const { carry } = controller.state;
    if (event.key === " ") {
      event.preventDefault();
      if (carry === null) controller.pickUp(bullet.id);
      else controller.drop();
    } else if (carry !== null && event.key === "Escape") {
      event.preventDefault();
      controller.cancelCarry();
    } else if (carry !== null && event.key.startsWith("Arrow")) {
      event.preventDefault();
      controller.carryStep(event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : event.key === "ArrowLeft" ? "left" : "right");
    }
  };

  return (
    <li
      ref={ref} role="listitem" tabIndex={0} data-card="" data-bullet-id={bullet.id}
      aria-label={bullet.placeholder ? PLACEHOLDER_TEXT : text.trim() === "" ? "Untitled" : text}
      className={`card-item${carried ? " is-lifted" : ""}${bullet.completed ? " is-complete" : ""}`}
      onKeyDown={onKeyDown} onPointerDown={(event) => onPointerDown(event, bullet)}
    >
      {bullet.placeholder ? PLACEHOLDER_TEXT : <RichText text={text} date={bullet.date} />}
    </li>
  );
}

export function Board({ controller, state }: { controller: OutlineController; state: ControllerState }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; x: number; y: number } | null>(null);
  const lists = controller.boardLists();
  const carriedBullet = drag === null ? undefined : state.view.bullets.get(drag.id);

  const begin = (event: { clientX: number; clientY: number }, element: HTMLElement, bullet: Bullet) => {
    const rect = element.getBoundingClientRect();
    controller.pickUp(bullet.id);
    setDrag({ id: bullet.id, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width });
    const move = (next: PointerEvent) => {
      setDrag((current) => (current === null ? current : { ...current, x: next.clientX, y: next.clientY }));
      const target = dropTarget(next.clientX, next.clientY, bullet.id);
      if (target !== null) controller.carryTo(target.container, target.index);
    };
    const block = (next: TouchEvent) => next.preventDefault();
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", block);
      setDrag(null);
      if (commit) controller.drop();
      else controller.cancelCarry();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", block, { passive: false });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLLIElement>, bullet: Bullet) => {
    if (bullet.placeholder || event.button !== 0 || controller.state.carry !== null) return;
    const element = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    if (event.pointerType === "touch") {
      const timer = setTimeout(() => begin({ clientX: start.x, clientY: start.y }, element, bullet), LONG_PRESS_MS);
      press.current = { timer, ...start };
      const cancelPress = (next: PointerEvent) => {
        if (press.current !== null && next.type === "pointermove" && Math.hypot(next.clientX - start.x, next.clientY - start.y) < MOVE_SLOP_PX) return;
        clearTimeout(press.current?.timer);
        press.current = null;
        window.removeEventListener("pointermove", cancelPress);
        window.removeEventListener("pointerup", cancelPress);
      };
      window.addEventListener("pointermove", cancelPress);
      window.addEventListener("pointerup", cancelPress);
      return;
    }
    const watch = (next: PointerEvent) => {
      if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < DRAG_START_PX) return;
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", stop);
      begin(next, element, bullet);
    };
    const stop = () => {
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", watch);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="board" data-tree="">
      {lists.map(({ column, container, cards }) => {
        const title = controller.textOf(column);
        return (
          <section
            key={column.id} role="region" aria-label={column.placeholder ? PLACEHOLDER_TEXT : title.trim() === "" ? "Untitled" : title}
            className="column-panel" data-column={container}
          >
            <header className="column-head">
              <h2>{column.placeholder ? PLACEHOLDER_TEXT : <RichText text={title} date={column.date} />}</h2>
              <span className="count">{cards.length === 1 ? "1 card" : `${cards.length} cards`}</span>
            </header>
            <ul role="list" className="cards" aria-label={`Cards in ${bulletLabel(title)}`}>
              {cards.map((id) => {
                const bullet = state.view.bullets.get(id);
                return bullet === undefined ? null : (
                  <Card key={id} bullet={bullet} controller={controller} carried={state.carry?.id === id} onPointerDown={onPointerDown} />
                );
              })}
            </ul>
          </section>
        );
      })}
      {drag !== null && carriedBullet !== undefined && (
        <div className="lifted-card" aria-hidden="true" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}>
          <RichText text={controller.textOf(carriedBullet)} date={carriedBullet.date} />
        </div>
      )}
    </div>
  );
}
