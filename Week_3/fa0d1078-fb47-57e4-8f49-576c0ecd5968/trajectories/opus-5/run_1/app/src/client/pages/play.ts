import type { GameShape, ResultShape } from '../../shared/api';
import { CELLS, cellColumn, cellName, cellRow, type Cell, type Digit } from '../../shared/board';
import { formatLongDate } from '../../shared/dates';
import { Game, type LoggedMove, type MoveOp } from '../../shared/engine';
import { M } from '../../shared/messages';
import { LEVEL_NAMES } from '../../shared/puzzles';
import { replayMoveLog } from '../../shared/replay';
import { formatTime } from '../../shared/score';
import { api, ApiFailure, clientConfig } from '../api';
import { announce } from '../announcer';
import type { BoardState } from '../board';
import { closeTopDialog, dialogOpen, openDialog, type DialogHandle } from '../dialog';
import { button, text } from '../dom';
import type { Cleanup, PageContext } from '../main';
import { navigate } from '../main';
import {
  CELEBRATION_MS,
  CELL_CELEBRATE_MS,
  CELL_CELEBRATE_STEP_MS,
  play,
  reducedMotion,
} from '../motion';
import { createPlayUi } from '../playUi';
import { renderNotFound } from './notfound';

const MISTAKE_LIMIT = clientConfig.mistake_limit;

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export async function renderPlay(context: PageContext): Promise<Cleanup | void> {
  let loaded: GameShape;
  try {
    const answer = await api.get<{ game: GameShape }>(`/api/games/${context.params.id}`);
    loaded = answer.game;
  } catch {
    renderNotFound(context.main, M.gameNotFound);
    return;
  }

  const game = loaded;
  const engine = new Game(game.puzzle, game.solution, game.start, {
    mistakeLimit: MISTAKE_LIMIT,
    hintLimit: clientConfig.hint_limit,
  });
  replayMoveLog(engine, game.moves, game.start.elapsed_ms, false);

  const moves: LoggedMove[] = [...game.moves];
  let elapsedMs = game.elapsed_ms;
  let runningSince: number | null = null;
  let paused = false;
  let status: BoardState = game.status === 'won' ? 'won' : engine.lost ? 'lost' : 'playing';
  let notesMode = false;
  const closedLoss = game.status === 'lost' && game.result !== null;

  const heading =
    game.mode === 'daily' && game.date
      ? `Daily, ${formatLongDate(game.date)}`
      : `${LEVEL_NAMES[game.level]} game`;
  context.main.append(text('h1', heading));

  const ui = createPlayUi(false, {
    onSelect: (cell) => select(cell),
    onDigit: (digit) => (notesMode ? noteDigit(digit) : enterDigit(digit)),
    onUndo: () => undo(),
    onRedo: () => redo(),
    onErase: () => erase(),
    onNotes: () => toggleNotes(),
    onHint: () => useHint(),
    onPause: () => (paused ? resume() : pause()),
  });
  context.main.append(ui.element);
  ui.board.selected = engine.firstEmptyCell();

  function activeMs(): number {
    return elapsedMs + (runningSince === null ? 0 : performance.now() - runningSince);
  }

  function startClock(): void {
    if (runningSince === null) runningSince = performance.now();
  }

  function stopClock(): void {
    if (runningSince === null) return;
    elapsedMs = activeMs();
    runningSince = null;
  }

  function boardState(): BoardState {
    if (paused) return 'paused';
    return status;
  }

  function render(): void {
    ui.board.render(engine, boardState());
    ui.timer.textContent = formatTime(Math.floor(activeMs() / 1000));
    ui.mistakes.textContent = `Mistakes: ${engine.mistakes}/${MISTAKE_LIMIT}`;
    if (ui.hintsLeft) ui.hintsLeft.textContent = `Hints left: ${engine.hintsLeft}`;
    if (!paused) ui.pad.setRemaining((digit) => engine.remainingFor(digit));
    if (ui.controls.hint) ui.controls.hint.disabled = engine.hintsLeft <= 0;
    ui.controls.notes.setAttribute('aria-pressed', notesMode ? 'true' : 'false');
    ui.hem.set(engine.correctCount);
  }

  const ticker = setInterval(() => {
    if (runningSince !== null) ui.timer.textContent = formatTime(Math.floor(activeMs() / 1000));
  }, 250);

  let saving = false;
  let saveAgain = false;

  async function save(): Promise<void> {
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    try {
      await api.put(`/api/games/${game.id}/moves`, {
        moves,
        elapsed_ms: Math.floor(activeMs()),
      });
      ui.saveNotice.textContent = '';
    } catch {
      ui.saveNotice.textContent = M.notSaved;
      announce(M.notSaved);
    } finally {
      saving = false;
      if (saveAgain) {
        saveAgain = false;
        void save();
      }
    }
  }

  function logMove(op: MoveOp, cell?: Cell, digit?: Digit): void {
    const move: LoggedMove = { n: moves.length + 1, t: Math.floor(activeMs()), op };
    if (cell) move.cell = cell;
    if (digit) move.digit = digit;
    moves.push(move);
    void save();
  }

  function select(cell: Cell): void {
    if (status !== 'playing' || paused) return;
    ui.board.selected = cell;
    render();
    ui.board.focusSelected();
  }

  function guardSentence(guard: 'given' | 'hinted' | 'correct'): string {
    if (guard === 'given') return M.givenLocked;
    return guard === 'hinted' ? M.hintedLocked : M.correctLocked;
  }

  function enterDigit(digit: Digit): void {
    if (status !== 'playing' || paused) return;
    const cell = ui.board.selected;
    const result = engine.enter(cell, digit);
    if (result.kind === 'guard') {
      announce(guardSentence(result.guard));
      return;
    }
    if (result.kind === 'unchanged') return;
    logMove('enter', cell, digit);
    render();
    announce(
      result.correct
        ? M.correctEntry(cell, digit)
        : M.mistakeEntry(cell, digit, engine.mistakes, MISTAKE_LIMIT),
    );
    if (engine.lost) lose();
    else if (engine.solved) void finish();
  }

  function noteDigit(digit: Digit): void {
    if (status !== 'playing' || paused) return;
    const cell = ui.board.selected;
    const result = engine.toggleNote(cell, digit);
    if (result.kind === 'guard') {
      announce(guardSentence(result.guard));
      return;
    }
    if (result.kind === 'unchanged') return;
    logMove('note', cell, digit);
    render();
    announce(result.added ? M.noteAdded(cell, digit) : M.noteRemoved(cell, digit));
  }

  function erase(): void {
    if (status !== 'playing' || paused) return;
    const cell = ui.board.selected;
    const result = engine.erase(cell);
    if (result.kind === 'guard') {
      announce(guardSentence(result.guard));
      return;
    }
    if (result.kind === 'unchanged') return;
    logMove('erase', cell);
    render();
    announce(M.erased(cell));
  }

  function undo(): void {
    if (status !== 'playing' || paused) return;
    if (!engine.canUndo) {
      announce(M.nothingToUndo);
      return;
    }
    engine.undo();
    logMove('undo');
    render();
    announce(M.undone);
  }

  function redo(): void {
    if (status !== 'playing' || paused) return;
    if (!engine.canRedo) {
      announce(M.nothingToRedo);
      return;
    }
    engine.redo();
    logMove('redo');
    render();
    announce(M.redone);
  }

  function toggleNotes(): void {
    if (status !== 'playing' || paused) return;
    notesMode = !notesMode;
    render();
    announce(notesMode ? M.notesOn : M.notesOff);
  }

  function useHint(): void {
    if (status !== 'playing' || paused) return;
    if (engine.hintsLeft <= 0) {
      announce(M.noHintsLeft);
      return;
    }
    const result = engine.hint();
    if (result.kind === 'none-left') {
      announce(M.noHintsLeft);
      return;
    }
    ui.board.selected = result.cell;
    logMove('hint', result.cell, result.digit);
    render();
    ui.board.focusSelected();
    announce(M.hint(result.cell, result.digit, result.hintsLeft));
    if (engine.solved) void finish();
  }

  let pausedDialog: DialogHandle | null = null;

  function pause(): void {
    if (status !== 'playing' || paused || dialogOpen()) return;
    paused = true;
    stopClock();
    logMove('pause');
    render();
    const resumeButton = button('Resume');
    resumeButton.addEventListener('click', () => resume());
    pausedDialog = openDialog({
      role: 'dialog',
      name: 'Paused',
      body: [text('p', M.pausedBody)],
      buttons: [resumeButton],
      closeOnEscape: false,
      focus: resumeButton,
    });
    announce(M.paused);
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    pausedDialog?.close();
    pausedDialog = null;
    startClock();
    logMove('resume');
    render();
    ui.board.focusSelected();
    announce(M.resumed);
  }

  function newGameButton(): HTMLButtonElement {
    const control = button('New game');
    control.addEventListener('click', () => {
      void (async () => {
        const created = await api
          .post<{ game: GameShape }>('/api/games', { level: game.level })
          .catch(() => null);
        if (created) navigate(`/play/${created.game.id}`);
      })();
    });
    return control;
  }

  function openGameOver(): void {
    const offerSecondChance = !closedLoss && engine.secondChanceAvailable;
    const buttons: HTMLButtonElement[] = [];
    let secondChanceButton: HTMLButtonElement | null = null;
    if (offerSecondChance) {
      secondChanceButton = button('Second chance');
      buttons.push(secondChanceButton);
    }
    const newGame = newGameButton();
    buttons.push(newGame);
    const handle = openDialog({
      role: 'alertdialog',
      name: 'Game over',
      body: [
        text('p', engine.secondChanceUsed ? M.gameOverBodyUsed(MISTAKE_LIMIT) : M.gameOverBody(MISTAKE_LIMIT)),
      ],
      buttons,
      closeOnEscape: false,
      focus: secondChanceButton ?? newGame,
    });
    secondChanceButton?.addEventListener('click', () => {
      const used = engine.secondChance();
      if (used.kind === 'unavailable') return;
      handle.close();
      status = 'playing';
      logMove('second_chance');
      render();
      startClock();
      ui.board.selected = used.cell;
      render();
      ui.board.focusSelected();
      announce(M.secondChance(used.mistakes, MISTAKE_LIMIT));
    });
  }

  function lose(): void {
    status = 'lost';
    stopClock();
    render();
    openGameOver();
    announce(M.gameOverAnnounce(MISTAKE_LIMIT));
  }

  /** One staggered animation across all 81 cells before the dialog opens. */
  async function celebrate(): Promise<void> {
    if (reducedMotion()) return;
    ui.board.element.setAttribute('data-celebrating', 'true');
    for (const cell of CELLS) {
      play(
        ui.board.cellElement(cell),
        [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
        {
          duration: CELL_CELEBRATE_MS,
          delay: (cellRow(cell) + cellColumn(cell) - 2) * CELL_CELEBRATE_STEP_MS,
          fill: 'backwards',
        },
      );
    }
    ui.hem.closeLoop();
    play(ui.plinth, [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }], {
      duration: CELEBRATION_MS,
      fill: 'forwards',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, CELEBRATION_MS));
    ui.board.element.removeAttribute('data-celebrating');
  }

  function openSolved(result: ResultShape): void {
    const time = formatTime(result.seconds);
    const newGame = newGameButton();
    const profile = button('View profile');
    profile.addEventListener('click', () => navigate('/profile'));
    openDialog({
      role: 'dialog',
      name: 'Puzzle solved',
      body: [text('p', M.solvedBody(time, result.mistakes, result.hints, result.score))],
      buttons: [newGame, profile],
      closeOnEscape: true,
      focus: newGame,
      returnFocus: () => ui.board.cellElement(ui.board.selected),
    });
    announce(M.solvedAnnounce(time, result.score));
  }

  function openNotCounted(code: string): void {
    const close = button('Close');
    const handle = openDialog({
      role: 'alertdialog',
      name: 'Not counted',
      body: [text('p', M.notCounted(code))],
      buttons: [close],
      closeOnEscape: true,
      focus: close,
      returnFocus: () => ui.board.cellElement(ui.board.selected),
    });
    close.addEventListener('click', () => handle.close());
    announce(M.notCounted(code));
  }

  async function finish(): Promise<void> {
    stopClock();
    ui.checking.textContent = M.checking;
    announce(M.checking);
    try {
      const answer = await api.post<{ result: ResultShape }>(`/api/games/${game.id}/finish`, { moves });
      ui.checking.textContent = '';
      status = 'won';
      render();
      await celebrate();
      openSolved(answer.result);
    } catch (cause) {
      ui.checking.textContent = '';
      if (cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500) {
        openNotCounted(cause.code);
        return;
      }
      ui.saveNotice.textContent = M.unexpected;
      announce(M.unexpected);
    }
  }

  function move(rowStep: number, columnStep: number): void {
    const cell = ui.board.selected;
    const row = ((cellRow(cell) - 1 + rowStep + 9) % 9) + 1;
    const column = ((cellColumn(cell) - 1 + columnStep + 9) % 9) + 1;
    select(cellName(row, column));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (isTextInput(event.target)) return;
    if (dialogOpen()) {
      if (paused && (event.key === 'p' || event.key === 'P')) {
        event.preventDefault();
        resume();
      }
      return;
    }
    if (status !== 'playing') return;

    if (event.key >= '1' && event.key <= '9' && event.key.length === 1) {
      event.preventDefault();
      const digit = Number(event.key) as Digit;
      if (notesMode) noteDigit(digit);
      else enterDigit(digit);
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        move(-1, 0);
        return;
      case 'ArrowDown':
        event.preventDefault();
        move(1, 0);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        move(0, -1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        move(0, 1);
        return;
      case 'Home':
        event.preventDefault();
        select(cellName(cellRow(ui.board.selected), 1));
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        erase();
        return;
      case 'End':
        event.preventDefault();
        select(cellName(cellRow(ui.board.selected), 9));
        return;
      default:
        break;
    }
    const letter = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && letter === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && letter === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (letter === 'n') {
      event.preventDefault();
      toggleNotes();
      return;
    }
    if (letter === 'h') {
      event.preventDefault();
      useHint();
      return;
    }
    if (letter === 'p') {
      event.preventDefault();
      pause();
    }
  }

  function onBlur(): void {
    pause();
  }

  function onVisibility(): void {
    if (document.hidden) pause();
  }

  document.addEventListener('keydown', onKeydown);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  render();
  if (status === 'lost') {
    openGameOver();
    announce(M.gameOverAnnounce(MISTAKE_LIMIT));
  } else if (status === 'playing') {
    startClock();
    render();
    ui.board.focusSelected();
  }

  return () => {
    clearInterval(ticker);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    while (dialogOpen()) closeTopDialog();
  };
}
