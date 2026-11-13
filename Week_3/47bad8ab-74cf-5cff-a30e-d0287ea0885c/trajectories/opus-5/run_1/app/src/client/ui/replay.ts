import { copy } from '../../shared/copy';
import type { Op, SolveRecord, SquareJson } from '../../shared/types';
import { attr, el, replace } from '../dom';
import { app } from '../state';
import { openDialog } from './overlay';

const squareKey = (row: number, col: number): string => `${row},${col}`;

function applyOp(squares: Map<string, SquareJson>, op: Op, ownerOf: (by: string) => string | null): void {
  if (op.type === 'cell') {
    squares.set(squareKey(op.row, op.col), {
      row: op.row,
      col: op.col,
      value: op.value,
      pencil: op.pencil,
      state: op.state,
      owner: op.owner,
    });
    return;
  }
  for (const square of op.squares) {
    const current = squares.get(squareKey(square.row, square.col));
    if (!current) continue;
    if (op.type === 'clear') {
      squares.set(squareKey(square.row, square.col), {
        ...current,
        value: '',
        pencil: false,
        state: 'empty',
        owner: null,
      });
      continue;
    }
    squares.set(squareKey(square.row, square.col), {
      ...current,
      value: square.value ?? current.value,
      pencil: square.state === 'right' || square.state === 'revealed' ? false : current.pencil,
      state: square.state,
      owner:
        op.type === 'reveal' || op.type === 'claim'
          ? ((ownerOf(op.by) ?? current.owner) as SquareJson['owner'])
          : current.owner,
    });
  }
}

function describe(record: SolveRecord, step: number): string {
  if (step === 0) return copy.replayStart;
  const op = record.ops[step - 1];
  const player = record.players.find((candidate) => candidate.id === op.by);
  const name = player ? player.display_name : 'A player';
  switch (op.type) {
    case 'cell':
      return copy.replayCell(name, op.value, op.pencil, op.row, op.col);
    case 'check':
      return copy.replayCheck(
        name,
        op.scope ?? 'square',
        op.squares.filter((square) => square.state === 'wrong').length,
      );
    case 'reveal':
      return copy.replayReveal(name, op.scope ?? 'square', op.squares.length);
    case 'clear':
      return copy.replayClear(name, op.scope ?? 'word', op.squares.length);
    case 'claim':
      return copy.replayCheck(name, 'square', 0);
  }
}

function isMarkOp(op: Op): boolean {
  return op.type === 'check' || op.type === 'reveal' || op.type === 'clear';
}

export function openReplayDialog(record: SolveRecord): void {
  const total = record.ops.length;
  let step = 0;
  let playing = false;
  let speed = 1;
  let timer = 0;

  const ownerOf = (playerId: string): string | null =>
    record.players.find((player) => player.id === playerId)?.colour ?? null;

  const gridHost = el('div', { role: 'group', 'aria-label': 'Replay grid', class: 'replay-grid' });
  const stepStatus = el('div', { role: 'status', 'aria-label': 'Replay step', class: 'status' });
  const opStatus = el('div', { role: 'status', 'aria-label': 'Replay op', class: 'status' });
  const previous = el('button', { type: 'button', class: 'button', text: 'Previous step' }) as HTMLButtonElement;
  const next = el('button', { type: 'button', class: 'button', text: 'Next step' }) as HTMLButtonElement;
  const play = el('button', { type: 'button', class: 'button', text: 'Play' }) as HTMLButtonElement;
  const slider = el('div', {
    role: 'slider',
    'aria-label': 'Replay position',
    class: 'slider',
    tabindex: '0',
    'aria-valuemin': '0',
    'aria-valuemax': String(total),
    'aria-valuenow': '0',
  });

  const squaresAt = (target: number): Map<string, SquareJson> => {
    const squares = new Map<string, SquareJson>(
      record.initial.map((square) => [squareKey(square.row, square.col), { ...square }]),
    );
    for (let index = 0; index < target; index += 1) applyOp(squares, record.ops[index], ownerOf);
    return squares;
  };

  const draw = (): void => {
    const squares = squaresAt(step);
    replace(
      gridHost,
      [...squares.values()]
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((square) =>
          el('div', {
            class: 'replay-cell',
            'data-row': square.row,
            'data-col': square.col,
            'data-value': square.value,
            'data-state': square.state,
            'data-owner': square.owner,
            text: square.value,
          }),
        ),
    );
    gridHost.style.setProperty('--cols', String(record.cols));
    stepStatus.textContent = copy.replayStep(step, total);
    opStatus.textContent = describe(record, step);
    attr(slider, 'aria-valuenow', String(step));
    previous.disabled = step === 0;
    next.disabled = step === total;
  };

  const stopPlaying = (): void => {
    playing = false;
    play.textContent = 'Play';
    window.clearInterval(timer);
  };

  const goTo = (target: number): void => {
    step = Math.max(0, Math.min(total, target));
    draw();
    if (playing && step === total) stopPlaying();
  };

  const startPlaying = (): void => {
    playing = true;
    play.textContent = 'Pause';
    if (step === total) step = 0;
    window.clearInterval(timer);
    timer = window.setInterval(() => goTo(step + 1), Math.max(1, Math.round(app.config.replay_step_ms / speed)));
  };

  previous.addEventListener('click', () => {
    stopPlaying();
    goTo(step - 1);
  });
  next.addEventListener('click', () => {
    stopPlaying();
    goTo(step + 1);
  });
  play.addEventListener('click', () => {
    if (playing) stopPlaying();
    else startPlaying();
  });

  const nextMark = (from: number, delta: number): number => {
    for (let index = from + delta; index >= 1 && index <= total; index += delta) {
      if (isMarkOp(record.ops[index - 1])) return index;
    }
    return delta > 0 ? total : 0;
  };

  slider.addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const handled = (): void => {
      keyboard.preventDefault();
      stopPlaying();
    };
    switch (keyboard.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        handled();
        goTo(keyboard.shiftKey ? nextMark(step, 1) : step + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        handled();
        goTo(keyboard.shiftKey ? nextMark(step, -1) : step - 1);
        break;
      case 'Home':
        handled();
        goTo(0);
        break;
      case 'End':
        handled();
        goTo(total);
        break;
      case 'PageUp':
        handled();
        goTo(step + 10);
        break;
      case 'PageDown':
        handled();
        goTo(step - 10);
        break;
      default:
        break;
    }
  });

  const speedRadio = (label: string, value: number): HTMLElement => {
    const input = el('input', {
      type: 'radio',
      name: 'replay-speed',
      'aria-label': label,
      checked: value === speed,
      onchange: () => {
        speed = value;
        if (playing) startPlaying();
      },
    });
    return el('label', { class: 'radio' }, [input, el('span', { text: label })]);
  };

  openDialog(
    { name: 'Replay', className: 'replay-dialog', onClose: () => window.clearInterval(timer) },
    (dialog) => [
      el('div', { class: 'tile dialog-tile' }, [
        el('h2', { text: `Replay: ${record.puzzle_title}` }),
        stepStatus,
        el('div', { class: 'dialog-actions' }, [previous, next]),
        slider,
        play,
        el('div', { role: 'radiogroup', 'aria-label': 'Replay speed', class: 'speeds' }, [
          speedRadio('1x', 1),
          speedRadio('2x', 2),
          speedRadio('4x', 4),
        ]),
        opStatus,
        gridHost,
        el('button', { type: 'button', class: 'button', text: 'Close', onclick: dialog.close }),
      ]),
    ],
  );
  draw();
}
