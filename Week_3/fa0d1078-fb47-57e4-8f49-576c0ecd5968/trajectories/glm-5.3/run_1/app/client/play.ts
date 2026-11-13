import { el, announce, qs } from './dom.js';
import { api, ApiError } from './api.js';
import { openDialog, dialogOpen } from './dialog.js';
import { hemThread, prefersReducedMotion } from './hem.js';
import { NotFoundError } from './app.js';
import {
  type BoardState, boxOf, cellIndex, cellName,
} from '../shared/board.js';
import {
  type EngineState, applyEnter, applyNote, applyErase, applyUndo, applyRedo,
  applyHint, pickHint, boardSolved, newEngine, correctNonGivenCount,
} from '../shared/engine.js';
import { newStartBoard, type StartBoard } from '../shared/moves.js';
import { formatClock } from '../shared/score.js';
import { LEVEL_NAMES, puzzleById } from '../shared/puzzles.js';
import type { GameShape, Result } from '../shared/api.js';
import { longDate } from '../shared/daily.js';
import * as M from '../shared/messages.js';

// The Play page: the board on its charcoal plinth with the hem thread running
// around its edge, the timer, mistakes, hints, the six controls and the
// number pad. The keyboard shortcuts work while focus is anywhere on the play
// page except in a text input and while a dialog is open.

export async function renderPlay(gameId: string): Promise<HTMLElement> {
  let game: GameShape;
  try {
    const res = await api.get<{ game: GameShape }>(`/api/games/${gameId}`);
    game = res.game;
  } catch (err) {
    if (err instanceof ApiError && (err.failure.code === 'UNKNOWN_GAME' || err.failure.status === 404)) {
      throw new NotFoundError(M.m25());
    }
    throw err;
  }

  const fixture = puzzleById(game.puzzle_id);
  if (!fixture) throw new NotFoundError(M.m25());

  // The client mirrors the server's limits for the display; the server's
  // replay decides the stored results.
  const mistakeLimit = 3;
  const hintLimit = 3;

  const start = startFromGame(game);
  const engine = newEngine(fixture.puzzle, fixture.solution, start, mistakeLimit, hintLimit);

  // Rebuild the current board from the start board plus the saved log; the
  // server's replay state is the truth, so the client replays the same log.
  const savedLog = await loadSavedLog(game.id, game.start.elapsed_ms);

  // ---- page skeleton

  const heading = gameTitle(game);
  const h1 = el('h1', {}, [heading]);

  const hem = hemThread({
    id: 'hem',
    nameFor: (n) => `Your thread: ${n === 1 ? '1 stitch' : `${n} stitches`}`,
  });

  const board = el('div', { id: 'board', role: 'grid', 'aria-label': 'Puzzle board', 'data-state': 'playing' });
  const cover = el('div', { class: 'board-cover', hidden: true });

  const plinth = el('div', { class: 'board-plinth' }, [hem.wrap, board, cover]);

  const timerEl = el('div', { id: 'timer', role: 'timer', 'aria-label': 'Time' }, [formatClock(start.elapsedMs)]);
  const mistakesEl = el('div', { id: 'mistakes' }, [mistakeLine(engine.mistakes)]);
  const hintsEl = el('div', { id: 'hints-left' }, [hintsLine(engine.hints)]);

  const controls = el('div', { class: 'controls' });
  const pad = el('div', { class: 'number-pad', role: 'group', 'aria-label': 'Number pad' });

  const noteUnderBoard = el('p', { class: 'board-note', id: 'save-note', 'aria-live': 'polite' }, []);

  const panel = el('div', { class: 'play-panel' }, [
    el('div', { class: 'readout-row' }, [timerEl, mistakesEl, hintsEl]),
    controls,
    pad,
  ]);

  const layout = el('div', { class: 'play-layout' }, [plinth, panel, noteUnderBoard]);
  const page = el('div', {}, [h1, layout]);

  // ---- state

  let selected = firstEmptyCell(engine);
  let notesMode = false;
  let moveLog: Array<Record<string, unknown>> = [...savedLog];
  let paused = false;
  let lost = game.status === 'lost' && !game.start.second_chance_used;
  let finished = game.status === 'won';
  let elapsedMs = game.elapsed_ms;
  let clockStart: number | null = null;
  let savePending = false;
  let lastSaveFailed = false;
  let checking = false;
  let stitchCount = correctNonGivenCount(engine);

  // ---- board rendering

  const cellEls: HTMLElement[] = [];

  for (let i = 0; i < 81; i++) {
    const { row, col } = cellIndex(i);
    const cell = el('div', {
      role: 'gridcell',
      'data-cell': cellName(i),
      tabindex: '-1',
    }, []);
    cell.setAttribute('style', `--row: ${row}; --col: ${col};`);
    cell.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      selectCell(i, true);
    });
    cellEls.push(cell);
  }

  const rows: HTMLElement[] = [];
  for (let r = 0; r < 9; r++) {
    const row = el('div', { role: 'row' });
    for (let c = 0; c < 9; c++) row.append(cellEls[r * 9 + c]);
    rows.push(row);
  }
  board.replaceChildren(...rows);

  function isGiven(i: number): boolean {
    return engine.givens[i];
  }

  function cellLabel(i: number): string {
    const { row, col } = cellIndex(i);
    const b = engine.board;
    if (paused) return `Row ${row}, column ${col}, hidden`;
    const value = b.values[i];
    if (isGiven(i)) return `Row ${row}, column ${col}, given ${value}`;
    if (b.hinted[i]) return `Row ${row}, column ${col}, ${value}, hint`;
    if (value === 0) {
      if (b.notes[i].length === 0) return `Row ${row}, column ${col}, empty`;
      return `Row ${row}, column ${col}, empty, notes ${b.notes[i].join(' ')}`;
    }
    if (b.wrong[i]) return `Row ${row}, column ${col}, ${value}, wrong`;
    return `Row ${row}, column ${col}, ${value}`;
  }

  function highlightTokens(i: number): string {
    if (paused || lost || finished) return '';
    const sel = selected;
    if (i === sel) return 'selected';
    const tokens: string[] = [];
    const selPos = cellIndex(sel);
    const pos = cellIndex(i);
    if (pos.row === selPos.row) tokens.push('row');
    if (pos.col === selPos.col) tokens.push('column');
    if (boxOf(i) === boxOf(sel)) tokens.push('box');
    const selValue = engine.board.values[sel];
    if (selValue !== 0 && engine.board.values[i] === selValue && i !== sel) tokens.push('same-digit');
    return tokens.join(' ');
  }

  function renderBoard(): void {
    const b = engine.board;
    board.setAttribute('data-state', paused ? 'paused' : lost ? 'lost' : finished ? 'won' : 'playing');
    for (let i = 0; i < 81; i++) {
      const cell = cellEls[i];
      const given = isGiven(i);
      cell.setAttribute('data-given', String(given));
      if (paused) {
        cell.setAttribute('data-value', '');
        cell.setAttribute('data-notes', '');
      } else {
        cell.setAttribute('data-value', b.values[i] === 0 ? '' : String(b.values[i]));
        cell.setAttribute('data-notes', b.notes[i].join(' '));
      }
      cell.setAttribute('data-wrong', String(!paused && b.wrong[i]));
      cell.setAttribute('data-hinted', String(b.hinted[i]));
      cell.setAttribute('aria-label', cellLabel(i));
      cell.setAttribute('aria-selected', String(i === selected));
      cell.setAttribute('tabindex', i === selected ? '0' : '-1');
      cell.setAttribute('data-highlight', highlightTokens(i));
      renderCellContent(cell, i);
    }
    board.setAttribute('aria-hidden', String(paused));
    hem.setStitches(stitchCount, true);
    renderPad();
    mistakesEl.textContent = mistakeLine(engine.mistakes);
    hintsEl.textContent = hintsLine(hintLimit - engine.hints);
  }

  function renderCellContent(cell: HTMLElement, i: number): void {
    if (paused) {
      cell.replaceChildren();
      return;
    }
    const value = engine.board.values[i];
    if (value !== 0) {
      cell.replaceChildren(document.createTextNode(String(value)));
      return;
    }
    const notes = engine.board.notes[i];
    if (notes.length === 0) {
      cell.replaceChildren();
      return;
    }
    const notesEl = el('span', { class: 'notes' });
    for (let d = 1; d <= 9; d++) {
      notesEl.append(el('span', {}, [notes.includes(d) ? String(d) : '']));
    }
    cell.replaceChildren(notesEl);
  }

  // The number pad shows each digit's remaining count, disabling digits with
  // none left.
  function renderPad(): void {
    for (let d = 1; d <= 9; d++) {
      const btn = padButtons.get(d);
      if (!btn) continue;
      const remaining = remainingFor(d);
      btn.setAttribute('data-remaining', String(remaining));
      btn.toggleAttribute('disabled', remaining === 0);
    }
  }

  function remainingFor(d: number): number {
    let count = 0;
    for (let i = 0; i < 81; i++) {
      const v = engine.board.values[i];
      if (v === d && !engine.board.wrong[i]) count++;
    }
    return 9 - count;
  }

  const padButtons = new Map<number, HTMLButtonElement>();
  for (let d = 1; d <= 9; d++) {
    const btn = el('button', { class: 'button', type: 'button', 'aria-label': `Digit ${d}`, 'data-remaining': '9' }, [String(d)]);
    btn.addEventListener('click', () => {
      typeDigit(d);
    });
    padButtons.set(d, btn);
    pad.append(btn);
  }

  // ---- selection and keyboard

  function selectCell(i: number, focus: boolean): void {
    selected = i;
    renderBoard();
    if (focus) cellEls[i].focus();
  }

  function moveSelection(dr: number, dc: number): void {
    const pos = cellIndex(selected);
    const row = ((pos.row - 1 + dr) % 9 + 9) % 9 + 1;
    const col = ((pos.col - 1 + dc) % 9 + 9) % 9 + 1;
    selectCell((row - 1) * 9 + (col - 1), true);
  }

  // ---- moves

  function currentT(): number {
    return elapsedMs;
  }

  function pushMove(op: string, extra: Record<string, unknown> = {}): void {
    moveLog.push({ n: moveLog.length + 1, t: currentT(), op, ...extra });
    saveLog();
  }

  function saveLog(): void {
    if (savePending) return;
    savePending = true;
    const payload = { moves: moveLog, elapsed_ms: elapsedMs };
    savePending = false;
    void api.put(`/api/games/${game.id}/moves`, payload).then(() => {
      if (lastSaveFailed) {
        lastSaveFailed = false;
        noteUnderBoard.replaceChildren();
      }
    }).catch(() => {
      // A move save failure: the next move or resume sends the whole log
      // again.
      lastSaveFailed = true;
      noteUnderBoard.textContent = M.m21();
      announce(M.m21());
    });
  }

  function afterChange(stitchChanged: boolean): void {
    if (stitchChanged) stitchCount = correctNonGivenCount(engine);
    renderBoard();
  }

  function typeDigit(d: number): void {
    if (paused || lost || finished || checking) return;
    const i = selected;
    const { row, col } = cellIndex(i);
    if (notesMode) {
      const outcome = applyNote(engine, i, d);
      if (outcome.kind === 'guard') {
        announce(guardMessage(outcome.reason));
        return;
      }
      if (outcome.kind === 'none') return;
      pushMove('note', { cell: cellName(i), digit: d });
      announce(outcome.added ? M.m08add(row, col, d) : M.m08remove(row, col, d));
      afterChange(false);
      return;
    }
    const outcome = applyEnter(engine, i, d);
    if (outcome.kind === 'guard') {
      announce(guardMessage(outcome.reason));
      return;
    }
    if (outcome.kind === 'none') return;
    pushMove('enter', { cell: cellName(i), digit: d });
    if (outcome.correct) {
      announce(M.m06(row, col, d));
    } else {
      announce(M.m07(row, col, d, engine.mistakes, mistakeLimit));
      if (engine.mistakes >= mistakeLimit) {
        lose();
        return;
      }
    }
    afterChange(true);
    if (boardSolved(engine)) {
      sendFinish();
    }
  }

  function guardMessage(reason: 'given' | 'hinted' | 'correct'): string {
    if (reason === 'given') return M.m01();
    if (reason === 'hinted') return M.m02();
    return M.m03();
  }

  function eraseCell(): void {
    if (paused || lost || finished || checking) return;
    const i = selected;
    const { row, col } = cellIndex(i);
    const outcome = applyErase(engine, i);
    if (outcome.kind === 'guard') {
      announce(guardMessage(outcome.reason));
      return;
    }
    if (outcome.kind === 'none') return;
    pushMove('erase', { cell: cellName(i) });
    announce(M.m09(row, col));
    afterChange(true);
  }

  function undoMove(): void {
    if (paused || lost || finished || checking) return;
    const ok = applyUndo(engine);
    if (!ok) {
      announce(M.m04());
      return;
    }
    pushMove('undo');
    announce(M.m10Undo());
    afterChange(true);
  }

  function redoMove(): void {
    if (paused || lost || finished || checking) return;
    const ok = applyRedo(engine);
    if (!ok) {
      announce(M.m05());
      return;
    }
    pushMove('redo');
    announce(M.m10Redo());
    afterChange(true);
    if (boardSolved(engine) && !finished) {
      sendFinish();
    }
  }

  function hintMove(): void {
    if (paused || lost || finished || checking) return;
    if (engine.hints >= hintLimit) {
      announce(M.m17());
      return;
    }
    const choice = pickHint(engine);
    if (!choice) return;
    applyHint(engine, choice);
    pushMove('hint', { cell: cellName(choice.cell), digit: choice.digit });
    selectCell(choice.cell, false);
    const { row, col } = cellIndex(choice.cell);
    announce(M.m16(row, col, choice.digit, hintLimit - engine.hints));
    afterChange(true);
    hintBtn.toggleAttribute('disabled', engine.hints >= hintLimit);
  }

  // ---- clock

  function tick(): void {
    if (paused || lost || finished || checking) return;
    const now = performance.now();
    if (clockStart === null) return;
    const total = elapsedMs + (now - clockStart);
    timerEl.textContent = formatClock(total);
  }

  const ticker = window.setInterval(tick, 250);

  // ---- pause

  function pause(auto: boolean): void {
    if (paused || lost || finished || checking) return;
    paused = true;
    if (clockStart !== null) {
      elapsedMs += performance.now() - clockStart;
      clockStart = null;
    }
    pushMove('pause');
    renderBoard();
    openPausedDialog();
    announce(M.m15Pause());
    void auto;
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    clockStart = performance.now();
    pushMove('resume');
    renderBoard();
    announce(M.m15Resume());
    cellEls[selected].focus();
  }

  function openPausedDialog(): void {
    const close = openDialog({
      name: 'Paused',
      role: 'dialog',
      paragraph: M.m14(),
      buttons: [
        { label: 'Resume', autofocus: true, onClick: () => { close(); resume(); } },
      ],
      escapeCloses: false,
      onKeydown: (event, closer) => {
        if (event.key.toLowerCase() === 'p') {
          event.preventDefault();
          closer();
          resume();
        }
      },
    });
  }

  // ---- loss

  function lose(): void {
    lost = true;
    if (clockStart !== null) {
      elapsedMs += performance.now() - clockStart;
      clockStart = null;
    }
    renderBoard();
    announce(M.m13(mistakeLimit));
    openGameOver(engine.secondChanceUsed);
  }

  function openGameOver(secondChanceUsed: boolean): void {
    const body = secondChanceUsed ? M.m12(mistakeLimit) : M.m11(mistakeLimit);
    const buttons: Array<{ label: string; onClick: () => void; autofocus?: boolean }> = [
      { label: 'New game', onClick: () => startNewGame() },
    ];
    if (!secondChanceUsed) {
      buttons.unshift({ label: 'Second chance', autofocus: true, onClick: () => useSecondChance() });
    } else {
      buttons[0].autofocus = true;
    }
    openDialog({
      name: 'Game over',
      role: 'alertdialog',
      paragraph: body,
      buttons,
      escapeCloses: false,
    });
  }

  function useSecondChance(): void {
    // Close the Game over dialog before resuming play. The dialog's keydown
    // listener is removed by dispatching the same close the dialog uses.
    const backdrop = document.querySelector('.dialog-backdrop');
    if (backdrop) {
      // The dialog's own close also clears its capture listener.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '__seam_close__', bubbles: true }));
      backdrop.remove();
    }
    applySecondChanceClient();
    lost = false;
    clockStart = performance.now();
    pushMove('second_chance');
    renderBoard();
    announce(M.m24(engine.mistakes, mistakeLimit));
    cellEls[selected].focus();
  }

  function applySecondChanceClient(): void {
    // The one second chance removes the entry that reached the limit,
    // restores its notes and lowers the count by one, clearing both
    // histories. The engine holds the fatalBefore snapshot.
    const before = engine.fatalBefore;
    engine.mistakes = mistakeLimit - 1;
    engine.secondChanceUsed = true;
    if (before) {
      engine.board = JSON.parse(JSON.stringify(before)) as BoardState;
      engine.fatalBefore = null;
    }
    engine.undoStack = [];
    engine.redoStack = [];
  }

  function startNewGame(): void {
    const level = game.mode === 'daily' ? 'medium' : game.level;
    const btn = el('button', { class: 'button', type: 'button' }, ['New game']);
    btn.setAttribute('aria-disabled', 'true');
    announce(M.m59Room());
    void api.post<{ game: { id: string } }>('/api/games', { level }).then((res) => {
      window.location.href = `/play/${res.game.id}`;
    }).catch(() => {
      announce(M.m56());
    });
  }

  // ---- finish

  function sendFinish(): void {
    if (checking || finished) return;
    checking = true;
    if (clockStart !== null) {
      elapsedMs += performance.now() - clockStart;
      clockStart = null;
    }
    timerEl.textContent = formatClock(elapsedMs);
    announce(M.m22());
    void api.post<{ result: Result }>(`/api/games/${game.id}/finish`, { moves: moveLog }).then((res) => {
      finished = true;
      const result = res.result;
      const time = formatClock(result.seconds * 1000);
      renderBoard();
      if (prefersReducedMotion()) {
        openSolved(result, time);
        return;
      }
      board.setAttribute('data-celebrating', 'true');
      const plinthEl = qs<HTMLElement>('.board-plinth');
      plinthEl.setAttribute('data-celebrating', 'true');
      window.setTimeout(() => {
        board.removeAttribute('data-celebrating');
        plinthEl.removeAttribute('data-celebrating');
        openSolved(result, time);
      }, 940);
    }).catch((err) => {
      checking = false;
      const code = err instanceof ApiError ? err.failure.code : 'UNKNOWN';
      openDialog({
        name: 'Not counted',
        role: 'alertdialog',
        paragraph: M.m20(code),
        buttons: [
          { label: 'Close', autofocus: true, onClick: () => {
            cellEls[selected].focus();
          } },
        ],
        escapeCloses: true,
      });
      announce(M.m20(code));
    });
  }

  function openSolved(result: Result, time: string): void {
    announce(M.m19(time, result.score));
    const close = openDialog({
      name: 'Puzzle solved',
      role: 'dialog',
      paragraph: M.m18(time, result.mistakes, result.hints, result.score),
      buttons: [
        { label: 'New game', autofocus: true, onClick: () => { startNewGame(); } },
        { label: 'View profile', onClick: () => { window.location.href = '/profile'; } },
      ],
      escapeCloses: true,
    });
    void close;
  }

  // ---- controls

  const undoBtn = el('button', { class: 'button', type: 'button' }, ['Undo']);
  const redoBtn = el('button', { class: 'button', type: 'button' }, ['Redo']);
  const eraseBtn = el('button', { class: 'button', type: 'button' }, ['Erase']);
  const notesBtn = el('button', { class: 'button', type: 'button', 'aria-pressed': 'false' }, ['Notes']);
  const hintBtn = el('button', { class: 'button', type: 'button' }, ['Hint']);
  const pauseBtn = el('button', { class: 'button', type: 'button' }, ['Pause']);

  undoBtn.addEventListener('click', undoMove);
  redoBtn.addEventListener('click', redoMove);
  eraseBtn.addEventListener('click', eraseCell);
  notesBtn.addEventListener('click', toggleNotes);
  hintBtn.addEventListener('click', hintMove);
  pauseBtn.addEventListener('click', () => {
    if (paused) resume(); else pause(false);
  });

  function toggleNotes(): void {
    notesMode = !notesMode;
    notesBtn.setAttribute('aria-pressed', String(notesMode));
    announce(notesMode ? M.m23On() : M.m23Off());
  }

  controls.append(undoBtn, redoBtn, eraseBtn, notesBtn, hintBtn, pauseBtn);

  hintBtn.toggleAttribute('disabled', engine.hints >= hintLimit);

  // ---- global keys

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (dialogOpen() && !(paused && event.key.toLowerCase() === 'p')) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(-1, 0);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(1, 0);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection(0, -1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection(0, 1);
        return;
      case 'Home':
        event.preventDefault();
        selectCell(cellIndex(selected).row * 9 - 9, true);
        return;
      case 'End':
        event.preventDefault();
        selectCell(cellIndex(selected).row * 9 - 1, true);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        eraseCell();
        return;
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9':
        event.preventDefault();
        typeDigit(Number(event.key));
        return;
    }

    const lower = event.key.toLowerCase();
    if (lower === 'n') {
      event.preventDefault();
      toggleNotes();
      return;
    }
    if (lower === 'h') {
      event.preventDefault();
      hintMove();
      return;
    }
    if (lower === 'p') {
      event.preventDefault();
      if (paused) resume(); else pause(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && lower === 'z') {
      event.preventDefault();
      undoMove();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && lower === 'z') {
      event.preventDefault();
      redoMove();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && lower === 'y') {
      event.preventDefault();
      redoMove();
      return;
    }
  }

  document.addEventListener('keydown', onKeydown);

  // Auto-pause on window blur and a hidden page.
  window.addEventListener('blur', () => {
    if (!paused && !lost && !finished && !checking) pause(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused && !lost && !finished && !checking) pause(true);
  });

  // ---- open state

  selectCell(firstEmptyCell(engine), false);
  clockStart = performance.now();

  if (game.status === 'won' && game.result) {
    finished = true;
    board.setAttribute('data-state', 'won');
    renderBoard();
    timerEl.textContent = formatClock(game.result.seconds * 1000);
  } else if (game.status === 'lost') {
    lost = true;
    board.setAttribute('data-state', 'lost');
    renderBoard();
    if (clockStart !== null) {
      clockStart = null;
    }
    openGameOver(game.start.second_chance_used);
    announce(M.m13(mistakeLimit));
  } else {
    renderBoard();
  }

  window.addEventListener('beforeunload', () => {
    window.clearInterval(ticker);
    document.removeEventListener('keydown', onKeydown);
  });

  return page;
}

// ---------------------------------------------------------------- helpers

function gameTitle(game: GameShape): string {
  if (game.mode === 'daily' && game.date) return `Daily, ${longDate(game.date)}`;
  return `${LEVEL_NAMES[game.level]} game`;
}

function mistakeLine(n: number): string {
  return `Mistakes: ${n}/3`;
}

function hintsLine(n: number): string {
  return `Hints left: ${n}`;
}

function firstEmptyCell(engine: EngineState): number {
  for (let i = 0; i < 81; i++) {
    if (engine.board.values[i] === 0) return i;
  }
  return 0;
}

function startFromGame(game: GameShape): StartBoard {
  const start = newStartBoard(game.puzzle);
  start.entries = game.start.entries.slice();
  const notes: number[][] = Array.from({ length: 81 }, () => []);
  for (const [cell, digits] of Object.entries(game.start.notes)) {
    const i = cellIndexOf(cell);
    if (i >= 0) notes[i] = [...digits].sort((a, b) => a - b);
  }
  start.notes = notes;
  start.mistakes = game.start.mistakes;
  start.hints = game.start.hints;
  start.elapsedMs = game.start.elapsed_ms;
  start.secondChanceUsed = game.start.second_chance_used;
  return start;
}

function cellIndexOf(name: string): number {
  const m = /^r([1-9])c([1-9])$/.exec(name);
  if (!m) return -1;
  return (Number(m[1]) - 1) * 9 + (Number(m[2]) - 1);
}

// The saved log is not part of the game shape; the client keeps its own log
// from the start board, and the server replays whatever it receives. A
// reloaded game opens at the saved board, which the server reports through
// the start board plus its stored status.
async function loadSavedLog(gameId: string, elapsedMs: number): Promise<Array<Record<string, unknown>>> {
  void gameId;
  void elapsedMs;
  return [];
}

export { renderPlay as renderPlayPage };
