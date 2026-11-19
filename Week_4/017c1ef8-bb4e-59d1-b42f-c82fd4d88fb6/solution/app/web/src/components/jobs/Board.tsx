import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { announce } from '../../announce';
import { Menu } from '../../ui';
import type { ApplicationState } from '../../types';
import { type BoardCard, type BoardColumns, type Stage } from './jobModel';

interface BoardProps {
  columns: BoardColumns;
  stages: Stage[];
  /** Moves a card; resolves once the move is stored or refused (the page reloads the board either way). */
  onMove: (card: BoardCard, to: ApplicationState) => Promise<void>;
  onOpen: (card: BoardCard) => void;
  /** A card that should take focus (after a move or a refused move). */
  focusCardId: { id: string; n: number } | null;
}

interface Held {
  id: string;
  from: ApplicationState;
  target: ApplicationState;
}

interface Dragging {
  id: string;
  dx: number;
  dy: number;
  over: ApplicationState | null;
}

const DRAG_THRESHOLD = 5;

const labelOf = (stages: Stage[], state: ApplicationState): string => stages.find((stage) => stage.state === state)?.label ?? state;

/** The poster's board: one column per stage; cards move by drag, by the Move menu or by keyboard pickup. */
export function Board({ columns, stages, onMove, onOpen, focusCardId }: BoardProps) {
  const [held, setHeld] = useState<Held | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    if (!focusCardId) return;
    root.current?.querySelector<HTMLElement>(`[data-application-id="${focusCardId.id}"]`)?.focus();
  }, [focusCardId?.n]);

  const columnAt = (x: number, y: number): ApplicationState | null => {
    for (const element of document.elementsFromPoint(x, y)) {
      const column = element.closest<HTMLElement>('[data-board-column]');
      if (column) return column.dataset.boardColumn as ApplicationState;
    }
    return null;
  };

  const startDrag = (event: ReactPointerEvent<HTMLLIElement>, card: BoardCard): void => {
    if (event.button !== 0 || (event.target as Element).closest('button, [role="menu"]')) return;
    justDragged.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const move = (next: PointerEvent): void => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      active = true;
      setDragging({ id: card.id, dx, dy, over: columnAt(next.clientX, next.clientY) });
    };
    const finish = (up: PointerEvent, dropped: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      setDragging(null);
      if (!active) return;
      justDragged.current = true;
      const target = columnAt(up.clientX, up.clientY);
      if (dropped && target && card.moves.includes(target)) void onMove(card, target);
    };
    const end = (up: PointerEvent): void => finish(up, true);
    const cancel = (up: PointerEvent): void => finish(up, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  };

  const keyDown = (event: KeyboardEvent<HTMLLIElement>, card: BoardCard): void => {
    if (event.target !== event.currentTarget) return;
    const name = card.applicant.name;
    if (event.key === ' ') {
      event.preventDefault();
      if (!held || held.id !== card.id) {
        setHeld({ id: card.id, from: card.state, target: card.state });
        announce('Jobs announcements', `Picked up ${name}`);
        return;
      }
      setHeld(null);
      if (held.target === card.state) announce('Jobs announcements', 'Move cancelled.');
      else void onMove(card, held.target);
    } else if (event.key === 'Escape' && held?.id === card.id) {
      event.preventDefault();
      event.stopPropagation();
      setHeld(null);
      announce('Jobs announcements', 'Move cancelled.');
    } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && held?.id === card.id) {
      event.preventDefault();
      const places = stages.map((stage) => stage.state).filter((state) => state === card.state || card.moves.includes(state));
      const index = places.indexOf(held.target);
      const next = places[event.key === 'ArrowRight' ? Math.min(places.length - 1, index + 1) : Math.max(0, index - 1)];
      if (next) setHeld({ ...held, target: next });
    }
  };

  const dropState = (state: ApplicationState): string | undefined => {
    if (held) return state === held.target ? 'target' : undefined;
    if (dragging) {
      const card = Object.values(columns)
        .flat()
        .find((candidate) => candidate.id === dragging.id);
      if (dragging.over === state) return card?.moves.includes(state) ? 'target' : 'illegal';
    }
    return undefined;
  };

  return (
    <div ref={root} className="board">
      {stages.map(({ state, label }) => {
        return (
          <section key={state} className="board-column" data-board-column={state} data-drop={dropState(state)}>
            <div className="board-head">
              <h2 className="board-label">{label}</h2>
              <span className="board-count t-display">{columns[state].length}</span>
            </div>
            <ul className="board-list plain-list" aria-label={label}>
              {columns[state].map((card) => (
                <li
                  key={card.id}
                  className="board-card"
                  tabIndex={0}
                  data-application-id={card.id}
                  data-state={card.state}
                  data-held={held?.id === card.id ? 'true' : undefined}
                  data-dragging={dragging?.id === card.id && (Math.abs(dragging.dx) > 0 || Math.abs(dragging.dy) > 0) ? 'true' : undefined}
                  style={dragging?.id === card.id ? { transform: `translate(${dragging.dx}px, ${dragging.dy}px)` } : undefined}
                  onPointerDown={(event) => startDrag(event, card)}
                  onKeyDown={(event) => keyDown(event, card)}
                  onClickCapture={(event) => {
                    if (justDragged.current) {
                      justDragged.current = false;
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                >
                  <a
                    href={`#application-${card.id}`}
                    className="board-name"
                    draggable={false}
                    onClick={(event) => {
                      event.preventDefault();
                      onOpen(card);
                    }}
                  >
                    {card.applicant.name}
                  </a>
                  <p className="muted">{card.applicant.headline}</p>
                  {card.moves.length > 0 ? (
                    <Menu
                      label={`Move ${card.applicant.name}`}
                      items={card.moves.map((to) => ({ label: `Move to ${labelOf(stages, to)}`, onSelect: () => void onMove(card, to) }))}
                    >
                      Move
                    </Menu>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
