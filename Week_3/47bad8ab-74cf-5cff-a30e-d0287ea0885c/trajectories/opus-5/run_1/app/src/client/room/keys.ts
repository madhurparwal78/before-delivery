import { indexInWord, wordSquares } from '../../shared/grid';
import type { Room } from './session';

export interface RoomUi {
  openRebus: () => void;
  openCheckMenu: () => void;
  openRevealMenu: () => void;
  openClearMenu: () => void;
  focusPauseButton: () => void;
}

function whiteStep(
  room: Room,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number } | null {
  let r = row + dr;
  let c = col + dc;
  while (r >= 0 && r < room.puzzle.rows && c >= 0 && c < room.puzzle.cols) {
    if (room.puzzle.blocks[r][c] !== '#') return { row: r, col: c };
    r += dr;
    c += dc;
  }
  return null;
}

function move(room: Room, dr: number, dc: number): void {
  const next = whiteStep(room, room.selection.row, room.selection.col, dr, dc);
  if (!next) return;
  room.setSelection({ ...next, direction: room.selection.direction });
}

function backspace(room: Room): void {
  const { row, col } = room.selection;
  if (room.locked(row, col)) return;
  if (room.filled(row, col)) {
    room.clearSquare(row, col);
    return;
  }
  const word = room.word();
  const index = indexInWord(word, row, col);
  if (index === 0) return;
  const previous = wordSquares(word)[index - 1];
  room.setSelection({ ...previous, direction: word.direction });
  if (!room.locked(previous.row, previous.col)) room.clearSquare(previous.row, previous.col);
}

/** The grid keyboard rules; the grid is one Tab stop. */
export function handleGridKey(room: Room, ui: RoomUi, event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const direction = room.selection.direction;
  const along = (key: string): boolean =>
    direction === 'across' ? key === 'ArrowLeft' || key === 'ArrowRight' : key === 'ArrowUp' || key === 'ArrowDown';

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    if (room.readOnly && room.deadLink !== null) return;
    room.writeLetter(event.key.toUpperCase(), room.pencil);
    return;
  }

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      event.preventDefault();
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      };
      const [dr, dc] = deltas[event.key];
      if (along(event.key)) {
        move(room, dr, dc);
        return;
      }
      if (room.canSwitchDirection()) room.switchDirection();
      else move(room, dr, dc);
      return;
    }
    case ' ':
    case 'Enter':
      event.preventDefault();
      room.switchDirection();
      return;
    case 'Tab':
      event.preventDefault();
      room.stepClue(event.shiftKey ? -1 : 1);
      return;
    case 'Escape':
      event.preventDefault();
      ui.focusPauseButton();
      return;
    case 'Backspace':
      event.preventDefault();
      backspace(room);
      return;
    case 'Delete': {
      event.preventDefault();
      const { row, col } = room.selection;
      if (!room.locked(row, col)) room.clearSquare(row, col);
      return;
    }
    case '.':
      event.preventDefault();
      room.setPencil(!room.pencil);
      return;
    case 'Insert':
      event.preventDefault();
      ui.openRebus();
      return;
    default:
      return;
  }
}

/** Alt+C, Alt+R, Alt+X and Alt+L work from any room control. */
export function handleRoomShortcut(room: Room, ui: RoomUi, event: KeyboardEvent): void {
  if (!event.altKey) return;
  const code = event.code;
  if (code === 'KeyC') {
    event.preventDefault();
    ui.openCheckMenu();
  } else if (code === 'KeyR') {
    event.preventDefault();
    ui.openRevealMenu();
  } else if (code === 'KeyX') {
    event.preventDefault();
    ui.openClearMenu();
  } else if (code === 'KeyL') {
    const grid = room.elements?.grid;
    if (!grid || document.activeElement !== grid) return;
    event.preventDefault();
    room.stepLinkedClue();
  }
}
