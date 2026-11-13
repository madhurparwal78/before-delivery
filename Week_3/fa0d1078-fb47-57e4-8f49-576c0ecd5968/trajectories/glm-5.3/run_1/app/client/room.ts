import { el, announce, qs } from './dom.js';
import { api } from './api.js';
import { openDialog } from './dialog.js';
import { hemThread, prefersReducedMotion } from './hem.js';
import { session } from './session.js';
import type { RoomShape } from '../shared/api.js';
import { LEVEL_NAMES } from '../shared/puzzles.js';
import { formatClock } from '../shared/score.js';
import { NotFoundError } from './app.js';
import * as M from '../shared/messages.js';

// The Room page: before the start, the seat list and the Ready button; during
// play, the board with the same layout as Play plus the opponent's progress
// bar, mistakes and thread beside your own. The Hint and Pause buttons are
// absent in a duel.

interface DuelState {
  code: string;
  room: RoomShape | null;
  puzzle: string;
  values: number[];
  wrong: Set<string>;
  notes: Map<string, number[]>;
  mistakes: number;
  correct: number;
  empty: number;
  opponentCorrect: number;
  opponentMistakes: number;
  opponentName: string;
  selected: number;
  startedAt: number | null;
  elapsedMs: number;
  resultShown: boolean;
}

export async function renderRoomPage(code: string): Promise<HTMLElement> {
  let room: RoomShape;
  try {
    const res = await api.get<{ room: RoomShape }>(`/api/duels/${code}`);
    room = res.room;
  } catch {
    throw new NotFoundError(M.m26());
  }

  const h1 = el('h1', {}, [`Room ${code}`]);
  const page = el('div', { class: 'duel-room' });

  const state: DuelState = {
    code,
    room,
    puzzle: '',
    values: new Array<number>(81).fill(0),
    wrong: new Set(),
    notes: new Map(),
    mistakes: 0,
    correct: 0,
    empty: 48,
    opponentCorrect: 0,
    opponentMistakes: 0,
    opponentName: '',
    selected: -1,
    startedAt: null,
    elapsedMs: 0,
    resultShown: false,
  };

  // ---- pre-start

  const seatList = el('ul', { class: 'tile seat-list', role: 'list', 'aria-label': 'Seats' });
  const readyBtn = el('button', { class: 'button', type: 'button', 'aria-pressed': 'false' }, ['Ready']);
  const countdown = el('p', { id: 'countdown', class: 'form-result', role: 'status' }, []);
  const notice = el('p', { id: 'duel-notice', class: 'form-result', role: 'status' }, []);

  function seatName(seat: RoomShape['seats'][number]): string {
    return seat ? seat.display_name : M.m32();
  }

  function renderSeats(): void {
    if (!state.room) return;
    seatList.replaceChildren();
    for (const seat of state.room.seats) {
      seatList.append(el('li', {}, [seatName(seat)]));
    }
    readyBtn.setAttribute('aria-pressed', String(state.room.seats.find((s) => s?.display_name === session.player?.display_name)?.ready ?? false));
  }

  readyBtn.addEventListener('click', () => {
    const ready = readyBtn.getAttribute('aria-pressed') !== 'true';
    send({ type: 'ready', ready });
  });

  // ---- board during play

  const hem = hemThread({ id: 'hem', nameFor: (n) => `Your thread: ${n === 1 ? '1 stitch' : `${n} stitches`}` });
  const board = el('div', { id: 'board', role: 'grid', 'aria-label': 'Puzzle board', 'data-state': 'playing' });
  const plinth = el('div', { class: 'board-plinth' }, [hem.wrap, board]);

  const cellEls: HTMLElement[] = [];
  for (let i = 0; i < 81; i++) {
    const row = Math.floor(i / 9) + 1;
    const col = (i % 9) + 1;
    const cell = el('div', { role: 'gridcell', 'data-cell': `r${row}c${col}`, tabindex: '-1' });
    cell.setAttribute('style', `--row: ${row}; --col: ${col};`);
    cell.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      state.selected = i;
      renderBoard();
      cell.focus();
    });
    cellEls.push(cell);
  }
  const rowEls: HTMLElement[] = [];
  for (let r = 0; r < 9; r++) {
    const row = el('div', { role: 'row' });
    for (let c = 0; c < 9; c++) row.append(cellEls[r * 9 + c]);
    rowEls.push(row);
  }
  board.replaceChildren(...rowEls);

  const notesPad = el('div', { class: 'number-pad', role: 'group', 'aria-label': 'Number pad' });
  const notesBtn = el('button', { class: 'button', type: 'button', 'aria-pressed': 'false' }, ['Notes']);
  const undoBtn = el('button', { class: 'button', type: 'button' }, ['Undo']);
  const redoBtn = el('button', { class: 'button', type: 'button' }, ['Redo']);
  const eraseBtn = el('button', { class: 'button', type: 'button' }, ['Erase']);
  const controls = el('div', { class: 'controls' }, [undoBtn, redoBtn, eraseBtn, notesBtn]);

  let notesMode = false;
  notesBtn.addEventListener('click', () => {
    notesMode = !notesMode;
    notesBtn.setAttribute('aria-pressed', String(notesMode));
    announce(notesMode ? M.m23On() : M.m23Off());
  });

  const padButtons = new Map<number, HTMLButtonElement>();
  for (let d = 1; d <= 9; d++) {
    const btn = el('button', { class: 'button', type: 'button', 'aria-label': `Digit ${d}` }, [String(d)]);
    btn.addEventListener('click', () => sendMove(d));
    padButtons.set(d, btn);
    notesPad.append(btn);
  }
  undoBtn.addEventListener('click', () => send({ type: 'move', op: 'undo' }));
  redoBtn.addEventListener('click', () => send({ type: 'move', op: 'redo' }));

  const mistakesEl = el('div', { id: 'mistakes' }, [`Mistakes: 0/3`]);
  const timerEl = el('div', { id: 'timer', role: 'timer', 'aria-label': 'Time' }, ['00:00']);
  const panel = el('div', { class: 'play-panel' }, [
    el('div', { class: 'readout-row' }, [timerEl, mistakesEl]),
    controls,
    notesPad,
  ]);

  // The opponent's progress: a bar, mistakes and thread, never their digits.
  const yourBar = el('progress', { role: 'progressbar', 'aria-label': 'Your progress', 'aria-valuemin': '0', 'aria-valuemax': '48', 'aria-valuenow': '0', value: '0', max: '48' });
  const oppBar = el('progress', { role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': '0', 'aria-valuemax': '48', 'aria-valuenow': '0', value: '0', max: '48' });
  const oppLabel = el('div', { class: 'bar-label' }, ['']);
  const oppMistakes = el('div', { id: 'opponent-mistakes' }, ['Mistakes: 0/3']);
  const oppHem = hemThread({ id: 'hem-opponent', nameFor: (n) => `${state.opponentName}'s thread: ${n === 1 ? '1 stitch' : `${n} stitches`}` });

  function renderBoard(): void {
    board.setAttribute('data-state', state.startedAt !== null ? 'playing' : 'playing');
    for (let i = 0; i < 81; i++) {
      const cell = cellEls[i];
      const name = `r${Math.floor(i / 9) + 1}c${(i % 9) + 1}`;
      const given = state.puzzle[i] !== '0';
      cell.setAttribute('data-given', String(given));
      cell.setAttribute('data-value', given ? state.puzzle[i] : String(state.values[i] ?? 0));
      const notes = state.notes.get(name) ?? [];
      cell.setAttribute('data-notes', notes.join(' '));
      cell.setAttribute('data-wrong', String(state.wrong.has(name)));
      cell.setAttribute('data-hinted', 'false');
      cell.setAttribute('aria-selected', String(i === state.selected));
      cell.setAttribute('tabindex', i === state.selected ? '0' : '-1');
      cell.setAttribute('aria-label', duelCellLabel(i));
      if (!given && state.values[i]) {
        cell.replaceChildren(document.createTextNode(String(state.values[i])));
      } else if (given) {
        cell.replaceChildren(document.createTextNode(state.puzzle[i]));
      } else if (notes.length > 0) {
        const notesEl = el('span', { class: 'notes' });
        for (let d = 1; d <= 9; d++) notesEl.append(el('span', {}, [notes.includes(d) ? String(d) : '']));
        cell.replaceChildren(notesEl);
      } else {
        cell.replaceChildren();
      }
    }
    hem.setStitches(state.correct, true);
    oppHem.setStitches(state.opponentCorrect, true);
    mistakesEl.textContent = `Mistakes: ${state.mistakes}/3`;
    oppMistakes.textContent = `Mistakes: ${state.opponentMistakes}/3`;
    yourBar.setAttribute('aria-valuenow', String(state.correct));
    yourBar.setAttribute('value', String(state.correct));
    yourBar.setAttribute('aria-valuemax', String(state.empty));
    yourBar.setAttribute('max', String(state.empty));
    oppBar.setAttribute('aria-valuenow', String(state.opponentCorrect));
    oppBar.setAttribute('value', String(state.opponentCorrect));
    oppBar.setAttribute('aria-valuemax', String(state.empty));
    oppBar.setAttribute('max', String(state.empty));
    oppBar.setAttribute('aria-label', `${state.opponentName}'s progress`);
    oppLabel.textContent = `${state.opponentName}: ${state.opponentCorrect} of ${state.empty}`;
  }

  function duelCellLabel(i: number): string {
    const row = Math.floor(i / 9) + 1;
    const col = (i % 9) + 1;
    const name = `r${row}c${col}`;
    if (state.puzzle[i] !== '0') return `Row ${row}, column ${col}, given ${state.puzzle[i]}`;
    const value = state.values[i];
    if (!value) {
      const notes = state.notes.get(name) ?? [];
      if (notes.length === 0) return `Row ${row}, column ${col}, empty`;
      return `Row ${row}, column ${col}, empty, notes ${notes.join(' ')}`;
    }
    if (state.wrong.has(name)) return `Row ${row}, column ${col}, ${value}, wrong`;
    return `Row ${row}, column ${col}, ${value}`;
  }

  // ---- websocket

  let socket: WebSocket | null = null;

  function connect(): void {
    socket = new WebSocket(`${wsOrigin()}/ws`);
    socket.addEventListener('open', () => {
      send({ type: 'room', code });
    });
    socket.addEventListener('message', (event) => {
      void handle(JSON.parse((event as MessageEvent).data) as Record<string, unknown>);
    });
    socket.addEventListener('close', () => {
      // A dropped socket reconnects within the reload window.
      window.setTimeout(() => {
        if (!state.resultShown) connect();
      }, 1000);
    });
  }

  function send(message: Record<string, unknown>): void {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendMove(d: number): void {
    if (state.selected < 0 || state.startedAt === null) return;
    const name = `r${Math.floor(state.selected / 9) + 1}c${(state.selected % 9) + 1}`;
    if (notesMode) {
      send({ type: 'move', op: 'note', cell: name, digit: d });
    } else {
      send({ type: 'move', op: 'enter', cell: name, digit: d });
    }
  }

  async function handle(message: Record<string, unknown>): Promise<void> {
    const type = message['type'];
    if (type === 'room') {
      const room = message['room'] as RoomShape;
      state.room = room;
      renderSeats();
      return;
    }
    if (type === 'countdown') {
      const left = Number(message['seconds_left']);
      countdown.textContent = M.m33(left);
      announce(M.m33(left));
      return;
    }
    if (type === 'start') {
      state.puzzle = String(message['puzzle']);
      state.startedAt = Date.now();
      state.empty = countEmpty(state.puzzle);
      state.values = state.puzzle.split('').map(Number);
      state.wrong = new Set();
      state.notes = new Map();
      announce(M.m42());
      swapToPlay();
      renderBoard();
      return;
    }
    if (type === 'you') {
      const values = String(message['values'] ?? '');
      if (values.length === 81) state.values = values.split('').map(Number);
      const wrong = message['wrong'] as string[] ?? [];
      state.wrong = new Set(wrong);
      const notes = (message['notes'] ?? {}) as Record<string, number[]>;
      state.notes = new Map(Object.entries(notes));
      state.correct = Number(message['correct'] ?? 0);
      state.mistakes = Number(message['mistakes'] ?? 0);
      renderBoard();
      return;
    }
    if (type === 'progress') {
      state.opponentName = String(message['display_name'] ?? '');
      state.opponentCorrect = Number(message['correct'] ?? 0);
      state.opponentMistakes = Number(message['mistakes'] ?? 0);
      renderBoard();
      return;
    }
    if (type === 'presence') {
      const st = String(message['state']);
      const name = String(message['display_name'] ?? '');
      announce(st === 'reconnecting' ? M.m39Reconnecting(name) : M.m39Back(name));
      oppLabel.textContent = st === 'reconnecting' ? M.m39Reconnecting(name) : M.m39Back(name);
      return;
    }
    if (type === 'result') {
      state.resultShown = true;
      const outcome = String(message['outcome']);
      const winner = message['winner'] as string | null;
      const seconds = message['seconds'] as number | null;
      const time = seconds === null ? '' : formatClock(seconds * 1000);
      const sentence = resultSentence(outcome, winner, time);
      const resultEl = el('p', { id: 'duel-result', role: 'status' }, [sentence]);
      openDialog({
        name: 'Duel over',
        role: 'dialog',
        paragraph: sentence,
        buttons: [{ label: 'Back to duels', autofocus: true, onClick: () => { window.location.href = '/duel'; } }],
        escapeCloses: true,
        id: 'duel-over',
      });
      announce(sentence);
      void resultEl;
      void plinth;
      return;
    }
    if (type === 'error') {
      const code = String(message['code']);
      if (code === 'LIVE_UNAVAILABLE') {
        notice.textContent = M.m40();
        announce(M.m40());
      }
      return;
    }
  }

  function swapToPlay(): void {
    preStart.hidden = true;
    playArea.hidden = false;
    if (state.selected < 0) {
      state.selected = firstEmpty(state.puzzle);
    }
    cellEls[state.selected]?.focus();
  }

  const preStart = el('div', { class: 'tile' }, [seatList, readyBtn, countdown, notice]);
  const playArea = el('div', { hidden: true }, [
    el('div', { class: 'play-layout' }, [
      plinth,
      el('div', { class: 'play-panel' }, [
        panel,
        el('div', { class: 'progress-block' }, [
          el('div', { class: 'bar-label' }, ['']),
          yourBar,
          oppLabel,
          oppBar,
          oppMistakes,
          oppHem.wrap,
        ]),
      ]),
    ]),
  ]);

  renderSeats();
  page.append(h1, preStart, playArea);

  // Keyboard: the board's arrows move the selection; digits enter. H and P
  // announce M30 and M31 in a duel.
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT') return;
    if (state.startedAt === null) return;
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      moveSelection(event.key);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      sendMove(Number(event.key));
      return;
    }
    const lower = event.key.toLowerCase();
    if (lower === 'h') {
      event.preventDefault();
      announce(M.m30());
      return;
    }
    if (lower === 'p') {
      event.preventDefault();
      announce(M.m31());
      return;
    }
    if (lower === 'n') {
      event.preventDefault();
      notesMode = !notesMode;
      notesBtn.setAttribute('aria-pressed', String(notesMode));
      announce(notesMode ? M.m23On() : M.m23Off());
      return;
    }
    if (lower === 'z' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send({ type: 'move', op: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
  });

  function moveSelection(key: string): void {
    if (state.selected < 0) return;
    let row = Math.floor(state.selected / 9);
    let col = state.selected % 9;
    if (key === 'ArrowUp') row = (row + 8) % 9;
    if (key === 'ArrowDown') row = (row + 1) % 9;
    if (key === 'ArrowLeft') col = (col + 8) % 9;
    if (key === 'ArrowRight') col = (col + 1) % 9;
    if (key === 'Home') col = 0;
    if (key === 'End') col = 8;
    state.selected = row * 9 + col;
    renderBoard();
    cellEls[state.selected].focus();
  }

  connect();
  void qs;
  void prefersReducedMotion;
  void LEVEL_NAMES;
  return page;
}

function countEmpty(puzzle: string): number {
  let n = 0;
  for (const ch of puzzle) if (ch === '0') n++;
  return n;
}

function firstEmpty(puzzle: string): number {
  for (let i = 0; i < 81; i++) if (puzzle[i] === '0') return i;
  return 0;
}

function resultSentence(outcome: string, winner: string | null, time: string): string {
  const name = winner ?? '';
  switch (outcome) {
    case 'win': return M.m34(time);
    case 'loss': return M.m35(name, time);
    case 'tie': return M.m36();
    case 'out': return M.m37You(3, name);
    case 'opponent_out': return M.m37Opponent(name);
    case 'forfeit_win': return M.m38(name);
    default: return M.m36();
  }
}

function wsOrigin(): string {
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}
