import type { Cell, Digit } from '../shared/board';
import { BoardView } from './board';
import { button, el } from './dom';
import { HemThread } from './hem';
import { NumberPad } from './numberpad';

export interface PlayUiHandlers {
  onSelect(cell: Cell): void;
  onDigit(digit: Digit): void;
  onUndo(): void;
  onRedo(): void;
  onErase(): void;
  onNotes(): void;
  onHint(): void;
  onPause(): void;
}

export interface PlayControls {
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  erase: HTMLButtonElement;
  notes: HTMLButtonElement;
  hint: HTMLButtonElement | null;
  pause: HTMLButtonElement | null;
}

export interface PlayUi {
  element: HTMLElement;
  plinth: HTMLElement;
  side: HTMLElement;
  board: BoardView;
  hem: HemThread;
  pad: NumberPad;
  timer: HTMLElement;
  mistakes: HTMLElement;
  hintsLeft: HTMLElement | null;
  hemCount: HTMLElement;
  controls: PlayControls;
  checking: HTMLElement;
  saveNotice: HTMLElement;
}

/** The board on its plinth with the timer, counters, controls and pad beside it. */
export function createPlayUi(duel: boolean, handlers: PlayUiHandlers): PlayUi {
  const board = new BoardView(handlers.onSelect);
  const hem = new HemThread('Your thread', 'hem', 'hem-count');
  const pad = new NumberPad(handlers.onDigit);

  const checking = el('p', { class: 'checking' });
  const plinth = el('div', { class: 'plinth' }, [hem.element, board.element, checking]);

  const timer = el('span', { role: 'timer', 'aria-label': 'Time', id: 'timer', class: 'timer' }, ['00:00']);
  const mistakes = el('span', { id: 'mistakes', class: 'counter' });
  const counters = el('p', { class: 'counters' }, [mistakes]);
  let hintsLeft: HTMLElement | null = null;
  if (!duel) {
    hintsLeft = el('span', { id: 'hints-left', class: 'counter' });
    counters.append(hintsLeft);
  }

  const undo = button('Undo', { class: 'control' });
  const redo = button('Redo', { class: 'control' });
  const erase = button('Erase', { class: 'control' });
  const notes = button('Notes', { class: 'control', 'aria-pressed': 'false' });
  undo.addEventListener('click', handlers.onUndo);
  redo.addEventListener('click', handlers.onRedo);
  erase.addEventListener('click', handlers.onErase);
  notes.addEventListener('click', handlers.onNotes);
  const controlBar = el('div', { class: 'control-bar' }, [undo, redo, erase, notes]);

  let hint: HTMLButtonElement | null = null;
  let pause: HTMLButtonElement | null = null;
  if (!duel) {
    hint = button('Hint', { class: 'control' });
    pause = button('Pause', { class: 'control' });
    hint.addEventListener('click', handlers.onHint);
    pause.addEventListener('click', handlers.onPause);
    controlBar.append(hint, pause);
  }

  const hemCount = hem.counter;
  const saveNotice = el('p', { class: 'save-notice' });
  const side = el('div', { class: 'side' }, [
    el('p', { class: 'timer-line' }, [timer]),
    counters,
    controlBar,
    pad.element,
    el('p', { class: 'stitch-line' }, ['Stitches ', hemCount]),
  ]);

  const element = el('div', { class: 'play-layout' }, [plinth, side, saveNotice]);
  return {
    element,
    plinth,
    side,
    board,
    hem,
    pad,
    timer,
    mistakes,
    hintsLeft,
    hemCount,
    controls: { undo, redo, erase, notes, hint, pause },
    checking,
    saveNotice,
  };
}
