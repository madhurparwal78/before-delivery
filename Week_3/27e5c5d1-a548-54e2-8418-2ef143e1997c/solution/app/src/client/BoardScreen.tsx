import {
  useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { isWriter, type Card, type ListView } from '../shared/types.ts';
import { listById, visibleListIds, type BoardData } from './board-state.ts';
import { COPY, countText } from './copy.ts';
import { CheckIcon, EllipsisIcon, KeyboardIcon, LockIcon, PlusIcon, SettingsIcon, Sprig } from './icons.tsx';
import { Menu } from './overlay.tsx';
import {
  addList, cancelLift, changeStatus, clearReturnFocus, createCard, drop, focusNow, isPointerLifted, liftArrow, liftKeyboard, liftPointer, liftPointerTo, openCard, selectList,
  useStore, type Chip, type Lift,
} from './store.ts';
import { useUi } from './ui.ts';

const SLOP = 4;
const HOLD_MS = 500;

type Row = { kind: 'card'; card: Card; lifted: boolean } | { kind: 'placeholder' } | { kind: 'slot' };

/** What one list shows: the lifted card leaves its slot (a dashed placeholder stays) and appears where it would land. */
function rowsOf(list: ListView, lift: Lift | null, lifted: Card | undefined): Row[] {
  if (!lift || !lifted) return list.cards.map((card) => ({ kind: 'card', card, lifted: false }));
  const rest = list.cards.filter((card) => card.id !== lift.cardId);
  const here = list.id === lift.target.listId;
  const from = list.id === lift.origin.listId;
  const same = here && from && lift.target.index === lift.origin.index;
  const rows: Row[] = [];
  for (let i = 0; i <= rest.length; i++) {
    if (here && i === lift.target.index) rows.push(lift.mode === 'keyboard' ? { kind: 'card', card: lifted, lifted: true } : { kind: 'slot' });
    if (from && i === lift.origin.index && !(same && lift.mode === 'keyboard')) rows.push({ kind: 'placeholder' });
    const card = rest[i];
    if (card) rows.push({ kind: 'card', card, lifted: false });
  }
  return rows;
}

function MoverChip({ chip }: { chip: Chip }): ReactElement {
  return (
    <span role="img" aria-label={`Moved by ${chip.mover.displayName}`} className={`chip mover-chip ${chip.fading ? 'fading' : ''}`} style={{ '--person': `var(--mover-${chip.mover.colour})` } as CSSProperties}>
      {chip.mover.initials}
    </span>
  );
}

function CardActions({ card, listName }: { card: Card; listName: string }): ReactElement {
  const ui = useUi();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (): void => setAnchor(null);
  const act = (action: () => void) => (): void => {
    button.current?.focus();
    close();
    action();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="card-actions"
        aria-label={`Actions for ${card.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-list-name={listName}
        onClick={() => setAnchor(anchor ? null : button.current)}
      >
        <EllipsisIcon />
      </button>
      {anchor && (
        <Menu label={`Actions for ${card.title}`} anchor={anchor} onClose={close}>
          <button type="button" role="menuitem" onClick={act(() => ui.moveCard(card.id))}>Move to…</button>
          <button type="button" role="menuitem" onClick={act(() => void changeStatus(card, card.status === 'done' ? 'open' : 'done'))}>
            {card.status === 'done' ? 'Reopen' : 'Mark done'}
          </button>
          <button type="button" role="menuitem" onClick={act(() => void changeStatus(card, 'archived'))}>Archive</button>
        </Menu>
      )}
    </>
  );
}

/** Where a pointer is over the board: the list under it and the slot among that list's cards. */
function dropTarget(x: number, y: number, liftedId: string): { listId: string; index: number } | null {
  const list = document.elementsFromPoint(x, y).find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset['listId'] !== undefined);
  const listId = list?.dataset['listId'];
  if (!list || !listId) return null;
  const cards = [...list.querySelectorAll<HTMLElement>('[data-card-item]')].filter((el) => el.dataset['cardItem'] !== liftedId);
  const index = cards.filter((el) => {
    const box = el.getBoundingClientRect();
    return y > box.top + box.height / 2;
  }).length;
  return { listId, index };
}

function CardFace({ card, list, lifted, chip, writer }: { card: Card; list: ListView; lifted: boolean; chip: Chip | undefined; writer: boolean }): ReactElement {
  const dragged = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const target = useStore((s) => (lifted ? s.lift?.target : undefined));

  // A lifted card is a new element whenever it changes list; it keeps focus.
  useLayoutEffect(() => {
    if (lifted) button.current?.focus();
  }, [lifted, target?.listId, target?.index]);

  const startPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!writer || event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    dragged.current = false;
    const touch = event.pointerType === 'touch';
    const hold = touch
      ? window.setTimeout(() => {
          dragged.current = liftPointer(card.id, start.x, start.y);
        }, HOLD_MS)
      : undefined;
    const move = (e: PointerEvent): void => {
      const far = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!dragged.current) {
        if (touch && far > 8) {
          window.clearTimeout(hold);
          finish();
        } else if (!touch && far > SLOP) dragged.current = liftPointer(card.id, e.clientX, e.clientY);
      }
      if (dragged.current) {
        const target = dropTarget(e.clientX, e.clientY, card.id);
        if (target) liftPointerTo(target.listId, target.index, e.clientX, e.clientY);
      }
    };
    const up = (): void => {
      window.clearTimeout(hold);
      if (dragged.current) drop();
      finish();
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (lifted || (event.key === ' ' && writer)) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (lifted) drop();
        else liftKeyboard(card.id);
      } else if (lifted && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelLift();
      } else if (lifted && event.key === 'Tab') cancelLift();
      else if (lifted && event.key.startsWith('Arrow')) {
        event.preventDefault();
        liftArrow(event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : event.key === 'ArrowLeft' ? 'left' : 'right');
      }
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="card-title"
        data-card-button={card.id}
        onPointerDown={startPointer}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault();
        }}
        onClick={(event) => {
          if (dragged.current) {
            dragged.current = false;
            event.preventDefault();
            return;
          }
          if (!lifted) openCard(card.id);
        }}
      >
        {card.title}
      </button>
      <div className="card-meta">
        {card.labels.map((label) => (
          <span key={label} className="label">{label}</span>
        ))}
        {card.dueState === 'due_today' && <span className="due">Due today</span>}
        {card.dueState === 'overdue' && <span className="due overdue">Overdue</span>}
        {card.status === 'done' && (
          <span className="done-mark">
            <CheckIcon />
            Done
          </span>
        )}
        {card.checklist.length > 0 && <span className="progress">{card.checklist.filter((i) => i.done).length}/{card.checklist.length}</span>}
        {card.isPrivate && <LockIcon label="Private card" />}
        {card.owner && (
          <span role="img" aria-label={`Owner ${card.owner.displayName}`} className="chip" style={{ '--person': `var(--mover-${card.owner.colour})` } as CSSProperties}>
            {card.owner.initials}
          </span>
        )}
        {chip && <MoverChip chip={chip} />}
        {writer && <CardActions card={card} listName={list.name} />}
      </div>
    </>
  );
}

function CardItem({ card, list, lifted, writer }: { card: Card; list: ListView; lifted: boolean; writer: boolean }): ReactElement {
  const chip = useStore((s) => s.chips[card.id]);
  const style = chip ? ({ '--person': `var(--mover-${chip.mover.colour})` } as CSSProperties) : undefined;
  return (
    <li data-card-item={card.id} className={`card ${lifted ? 'lifted' : ''} ${chip ? 'moved' : ''} ${chip?.fading ? 'fading' : ''}`} {...(style ? { style } : {})}>
      <CardFace card={card} list={list} lifted={lifted} chip={chip} writer={writer} />
    </li>
  );
}

function AddCard({ list }: { list: ListView }): ReactElement {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    setPending(true);
    const fields = await createCard(list.id, title);
    flushSync(() => {
      setPending(false);
      if (fields === null) {
        setTitle('');
        setProblem(null);
      } else setProblem(fields['title'] ?? null);
    });
    field.current?.focus();
  };

  if (!open) {
    return (
      <button type="button" className="add-card" data-add-card={list.id} aria-label={`Add a card to ${list.name}`} onClick={() => {
        setOpen(true);
        queueMicrotask(() => field.current?.focus());
      }}>
        <PlusIcon />
        <span aria-hidden="true">Add a card</span>
      </button>
    );
  }
  return (
    <div className="add-form">
      <input
        ref={field}
        type="text"
        aria-label="New card title"
        value={title}
        disabled={pending}
        aria-invalid={problem !== null}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => {
              setOpen(false);
              setProblem(null);
              setTitle('');
            });
            focusNow(`[data-add-card="${list.id}"]`);
          }
        }}
      />
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}

function ListColumn({ list, board }: { list: ListView; board: BoardData }): ReactElement {
  const lift = useStore((s) => s.lift);
  const lifted = lift ? listById(board, lift.origin.listId)?.cards.find((c) => c.id === lift.cardId) : undefined;
  const writer = isWriter(board.role);
  const rows = rowsOf(list, lift, lifted);
  return (
    <section role="region" aria-label={list.name} id={`list-${list.id}`} className="list" data-list-id={list.id}>
      <h3>{list.name}</h3>
      <p className="list-count">{countText(list.count)}</p>
      {list.cards.length === 0 && !lift && (
        <div className="empty-list">
          <Sprig />
          <p>{COPY.emptyList}</p>
        </div>
      )}
      <ul aria-label={`${list.name} cards`}>
        {rows.map((row, index) =>
          row.kind === 'card' ? (
            <CardItem key={row.card.id} card={row.card} list={list} lifted={row.lifted} writer={writer} />
          ) : (
            <li key={`${row.kind}-${index}`} className={row.kind === 'slot' ? 'slot' : 'placeholder'} aria-hidden="true" />
          ),
        )}
      </ul>
      {writer && <AddCard list={list} />}
    </section>
  );
}

function AddList({ board, column = false }: { board: BoardData; column?: boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    setPending(true);
    const fields = await addList(board.id, name);
    flushSync(() => {
      setPending(false);
      if (fields === null) {
        setOpen(false);
        setName('');
      }
      setProblem(fields === null ? null : (fields['name'] ?? null));
    });
    if (fields !== null) field.current?.focus();
  };

  return open ? (
    <div className="add-form add-list-form">
      <input
        ref={field}
        type="text"
        aria-label="New list name"
        aria-invalid={problem !== null}
        value={name}
        disabled={pending}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => {
              setOpen(false);
              setProblem(null);
            });
            focusNow('[data-add-list]');
          }
        }}
      />
      {problem && <p className="field-error">{problem}</p>}
    </div>
  ) : (
    <button type="button" className={`outline add-list ${column ? 'column' : ''}`} data-add-list onClick={() => setOpen(true)}>
      <PlusIcon />
      Add a list
    </button>
  );
}

function Tabs({ board, selected }: { board: BoardData; selected: string | null }): ReactElement {
  const move = (event: ReactKeyboardEvent, index: number): void => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? board.lists.length - 1 : null;
    const list = next === null ? undefined : board.lists[next];
    if (!list) return;
    event.preventDefault();
    selectList(list.id);
    queueMicrotask(() => document.getElementById(`tab-${list.id}`)?.focus());
  };
  return (
    <div role="tablist" aria-label="Lists" className="tabs">
      {board.lists.map((list, index) => (
        <button
          key={list.id}
          id={`tab-${list.id}`}
          type="button"
          role="tab"
          aria-selected={list.id === selected}
          aria-controls={`list-${list.id}`}
          tabIndex={list.id === selected ? 0 : -1}
          onClick={() => selectList(list.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {list.name}
        </button>
      ))}
    </div>
  );
}

function Ghost(): ReactElement | null {
  const lift = useStore((s) => s.lift);
  const board = useStore((s) => s.board);
  const card = lift && board ? listById(board, lift.origin.listId)?.cards.find((c) => c.id === lift.cardId) : undefined;
  if (!lift || lift.mode !== 'pointer' || !lift.pointer || !card) return null;
  return createPortal(
    <div className="ghost-card" aria-hidden="true" style={{ left: lift.pointer.x + 8, top: lift.pointer.y + 8 }}>
      {card.title}
    </div>,
    document.body,
  );
}

export function BoardScreen({ board }: { board: BoardData }): ReactElement {
  const ui = useUi();
  const selected = useStore((s) => s.selectedListId);
  const mode = useStore((s) => s.viewMode);
  const returnFocusTo = useStore((s) => s.returnFocusTo);
  const shown = new Set(visibleListIds(board, selected, mode));
  const admin = board.role === 'admin';
  const main = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!returnFocusTo) return;
    document.querySelector<HTMLElement>(`[data-card-button="${returnFocusTo}"]`)?.focus();
    clearReturnFocus();
  }, [returnFocusTo]);

  // Registered before any touch starts, so the browser waits for it instead of starting a scroll under a dragged card.
  useEffect(() => {
    const hold = (event: TouchEvent): void => {
      if (isPointerLifted()) event.preventDefault();
    };
    document.addEventListener('touchmove', hold, { passive: false });
    return () => document.removeEventListener('touchmove', hold);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '?' || !target || !main.current?.contains(target)) return;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      ui.open('shortcuts');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ui]);

  return (
    <main ref={main} className="board" aria-label="Board">
      <div className="board-header">
        <h2>{board.name}</h2>
        <div className="board-tools">
          {admin && (
            <button type="button" className="outline" onClick={() => ui.open('settings')}>
              <SettingsIcon />
              Board settings
            </button>
          )}
          <button type="button" className="outline" onClick={() => ui.open('shortcuts')}>
            <KeyboardIcon />
            Keyboard shortcuts
          </button>
        </div>
      </div>
      {mode !== 'desktop' && board.lists.length > 0 && (
        <div className="switcher">
          <Tabs board={board} selected={selected} />
          {admin && <AddList board={board} />}
        </div>
      )}
      {board.lists.length === 0 && (
        <div className="no-lists">
          <Sprig />
          <p>{COPY.noLists}</p>
          {admin && <AddList board={board} />}
        </div>
      )}
      {board.lists.length > 0 && (
        <div className="lists">
          {board.lists.filter((list) => shown.has(list.id)).map((list) => (
            <ListColumn key={list.id} list={list} board={board} />
          ))}
          {mode === 'desktop' && admin && <AddList board={board} column />}
        </div>
      )}
      <Ghost />
    </main>
  );
}
