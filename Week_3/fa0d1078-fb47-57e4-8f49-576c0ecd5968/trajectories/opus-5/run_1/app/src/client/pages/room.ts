import type { RoomShape, ServerSocketMessage } from '../../shared/api';
import { CELLS, type Cell, type Digit } from '../../shared/board';
import { boardDigit, givenCells } from '../../shared/board';
import { M } from '../../shared/messages';
import { formatTime } from '../../shared/score';
import { api, ApiFailure, clientConfig } from '../api';
import { announce } from '../announcer';
import { emptyCellCount, type BoardSource } from '../board';
import { closeTopDialog, dialogOpen, openDialog } from '../dialog';
import { apply, button, clear, el, text } from '../dom';
import { HemThread } from '../hem';
import { LiveSocket } from '../live';
import type { Cleanup, PageContext } from '../main';
import { navigate, noticeFor } from '../main';
import { createPlayUi } from '../playUi';
import { renderNotFound } from './notfound';

const MISTAKE_LIMIT = clientConfig.mistake_limit;

interface YourBoard {
  values: string;
  wrong: Set<Cell>;
  notes: Map<Cell, Digit[]>;
  correct: number;
  mistakes: number;
}

/** The board shows only what the server's `you` message says. */
function boardSource(puzzle: string, state: YourBoard): BoardSource {
  const givens = givenCells(puzzle);
  return {
    isGiven: (cell) => givens.has(cell),
    valueAt: (cell) => boardDigit(state.values, cell),
    notesAt: (cell) => state.notes.get(cell) ?? [],
    isWrong: (cell) => state.wrong.has(cell),
    isHinted: () => false,
  };
}

export async function renderRoom(context: PageContext): Promise<Cleanup | void> {
  const { main } = context;
  const code = (context.params.code ?? '').toUpperCase();

  let room: RoomShape;
  try {
    room = (await api.get<{ room: RoomShape }>(`/api/duels/${code}`)).room;
  } catch (cause) {
    if (cause instanceof ApiFailure && cause.code === 'LIVE_UNAVAILABLE') {
      main.append(text('h1', `Room ${code}`));
      const notice = el('p', { id: 'duel-notice', class: 'notice' }, [M.liveUnavailable]);
      main.append(notice);
      announce(M.liveUnavailable);
      return;
    }
    renderNotFound(main, M.pageNotFound);
    return;
  }

  main.append(text('h1', `Room ${code}`));

  const seats = el('ul', { 'aria-label': 'Seats', class: 'seat-list' });
  const ready = button('Ready', { 'aria-pressed': 'false', class: 'primary' });
  const countdown = el('p', { id: 'countdown', class: 'countdown' });
  const notice = el('p', { id: 'duel-notice', class: 'notice' });
  const lobby = el('div', { class: 'tile lobby' }, [seats, ready, countdown]);
  main.append(lobby, notice);

  const yourProgress = el('div', {
    role: 'progressbar',
    'aria-label': 'Your progress',
    'aria-valuemin': '0',
    class: 'progress',
  });
  const opponentProgress = el('div', {
    role: 'progressbar',
    'aria-valuemin': '0',
    class: 'progress',
  });
  const opponentMistakes = el('span', { id: 'opponent-mistakes', class: 'counter' });
  const opponentPresence = el('p', { class: 'presence' });
  const opponentHem = new HemThread("Opponent's thread", 'hem-opponent', null);

  const ui = createPlayUi(true, {
    onSelect: (cell) => select(cell),
    onDigit: (digit) => (notesMode ? sendMove('note', cell(), digit) : sendMove('enter', cell(), digit)),
    onUndo: () => sendMove('undo'),
    onRedo: () => sendMove('redo'),
    onErase: () => sendMove('erase', cell()),
    onNotes: () => toggleNotes(),
    onHint: () => announce(M.hintsOffInDuels),
    onPause: () => announce(M.noPauseInDuels),
  });

  const opponentPanel = el('div', { class: 'opponent-panel' }, [
    opponentProgress,
    opponentMistakes,
    opponentHem.element,
    opponentPresence,
  ]);
  ui.side.prepend(yourProgress);
  ui.element.append(opponentPanel);
  const playArea = el('div', { class: 'play-area', hidden: true }, [ui.element]);
  main.append(playArea);

  let notesMode = false;
  let startedAt: number | null = null;
  let puzzle = '';
  let emptyAtStart = 0;
  let your: YourBoard = {
    values: '0'.repeat(81),
    wrong: new Set(),
    notes: new Map(),
    correct: 0,
    mistakes: 0,
  };
  let opponentName = '';

  function cell(): Cell {
    return ui.board.selected;
  }

  function renderSeats(): void {
    clear(seats);
    for (let index = 0; index < 2; index += 1) {
      const seat = room.seats[index];
      seats.append(el('li', { class: 'seat' }, [seat ? seat.display_name : M.waitingForSecondPlayer]));
    }
    const mine = room.seats.find((seat) => seat.display_name === context.player?.display_name);
    ready.setAttribute('aria-pressed', mine?.ready ? 'true' : 'false');
    ready.disabled = room.state === 'countdown' || room.state === 'playing';
    const other = room.seats.find((seat) => seat.display_name !== context.player?.display_name);
    if (other) {
      opponentName = other.display_name;
      apply(opponentProgress, { 'aria-label': `${opponentName}'s progress` });
      opponentHem.setPrefix(`${opponentName}'s thread`);
    }
  }

  function renderBoard(): void {
    ui.board.render(boardSource(puzzle, your), 'playing');
    ui.mistakes.textContent = `Mistakes: ${your.mistakes}/${MISTAKE_LIMIT}`;
    ui.pad.setRemaining((digit) => remainingFor(digit));
    ui.controls.notes.setAttribute('aria-pressed', notesMode ? 'true' : 'false');
    ui.hem.set(your.correct);
    apply(yourProgress, {
      'aria-valuemax': String(emptyAtStart),
      'aria-valuenow': String(your.correct),
    });
    yourProgress.textContent = `You: ${your.correct} of ${emptyAtStart}`;
  }

  function remainingFor(digit: Digit): number {
    let placed = 0;
    for (const target of CELLS) {
      if (boardDigit(your.values, target) !== digit) continue;
      if (your.wrong.has(target)) continue;
      placed += 1;
    }
    return 9 - placed;
  }

  function select(target: Cell): void {
    ui.board.selected = target;
    renderBoard();
    ui.board.focusSelected();
  }

  function toggleNotes(): void {
    notesMode = !notesMode;
    ui.controls.notes.setAttribute('aria-pressed', notesMode ? 'true' : 'false');
    announce(notesMode ? M.notesOn : M.notesOff);
  }

  function sendMove(
    op: 'enter' | 'note' | 'erase' | 'undo' | 'redo',
    target?: Cell,
    digit?: Digit,
  ): void {
    if (room.state !== 'playing') return;
    socket.send({ type: 'move', op, ...(target ? { cell: target } : {}), ...(digit ? { digit } : {}) });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (dialogOpen()) return;
    if (event.target instanceof HTMLElement && event.target.tagName === 'INPUT') return;
    if (event.key >= '1' && event.key <= '9' && event.key.length === 1) {
      event.preventDefault();
      const digit = Number(event.key) as Digit;
      sendMove(notesMode ? 'note' : 'enter', cell(), digit);
      return;
    }
    const letter = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && letter === 'z') {
      event.preventDefault();
      sendMove(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && letter === 'y') {
      event.preventDefault();
      sendMove('redo');
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End': {
        event.preventDefault();
        select(stepCell(event.key));
        return;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        sendMove('erase', cell());
        return;
      default:
        break;
    }
    if (letter === 'n') {
      event.preventDefault();
      toggleNotes();
      return;
    }
    if (letter === 'h') {
      event.preventDefault();
      announce(M.hintsOffInDuels);
      return;
    }
    if (letter === 'p') {
      event.preventDefault();
      announce(M.noPauseInDuels);
    }
  }

  function stepCell(key: string): Cell {
    const current = cell();
    const row = Number(current[1]);
    const column = Number(current[3]);
    const wrap = (value: number, step: number): number => ((value - 1 + step + 9) % 9) + 1;
    if (key === 'ArrowUp') return `r${wrap(row, -1)}c${column}`;
    if (key === 'ArrowDown') return `r${wrap(row, 1)}c${column}`;
    if (key === 'ArrowLeft') return `r${row}c${wrap(column, -1)}`;
    if (key === 'ArrowRight') return `r${row}c${wrap(column, 1)}`;
    return `r${row}c${key === 'Home' ? 1 : 9}`;
  }

  function resultSentence(message: Extract<ServerSocketMessage, { type: 'result' }>): string {
    const time = formatTime(message.seconds ?? 0);
    const name = message.winner ?? opponentName;
    switch (message.outcome) {
      case 'win':
        return M.duelWin(time);
      case 'loss':
        return M.duelLoss(name, time);
      case 'tie':
        return M.duelTie;
      case 'out':
        return M.duelOut(MISTAKE_LIMIT, name);
      case 'opponent_out':
        return M.duelOpponentOut(opponentName);
      case 'forfeit_win':
        return M.duelForfeitWin(opponentName);
    }
  }

  function openResult(message: Extract<ServerSocketMessage, { type: 'result' }>): void {
    const sentence = resultSentence(message);
    const back = button('Back to duels');
    back.addEventListener('click', () => navigate('/duel'));
    openDialog({
      role: 'dialog',
      name: 'Duel over',
      body: [el('p', { id: 'duel-result', role: 'status' }, [sentence])],
      buttons: [back],
      closeOnEscape: true,
      focus: back,
    });
    announce(sentence);
  }

  function handle(message: ServerSocketMessage): void {
    switch (message.type) {
      case 'room':
        room = message.room;
        renderSeats();
        return;
      case 'countdown':
        countdown.textContent = M.startingIn(message.seconds_left);
        announce(M.startingIn(message.seconds_left));
        return;
      case 'start':
        puzzle = message.puzzle;
        emptyAtStart = emptyCellCount(puzzle);
        lobby.hidden = true;
        playArea.hidden = false;
        ui.board.selected = firstEmpty(puzzle);
        renderBoard();
        ui.board.focusSelected();
        startedAt = performance.now();
        announce(M.duelStarted);
        return;
      case 'you':
        your = {
          values: message.values,
          wrong: new Set(message.wrong),
          notes: new Map(Object.entries(message.notes) as [Cell, Digit[]][]),
          correct: message.correct,
          mistakes: message.mistakes,
        };
        renderBoard();
        return;
      case 'progress':
        opponentName = message.display_name;
        apply(opponentProgress, {
          'aria-label': `${opponentName}'s progress`,
          'aria-valuemax': String(emptyAtStart),
          'aria-valuenow': String(message.correct),
        });
        opponentProgress.textContent = `${opponentName}: ${message.correct} of ${emptyAtStart}`;
        opponentMistakes.textContent = `Mistakes: ${message.mistakes}/${MISTAKE_LIMIT}`;
        opponentHem.setPrefix(`${opponentName}'s thread`);
        opponentHem.set(message.correct);
        return;
      case 'presence': {
        const sentence =
          message.state === 'reconnecting'
            ? M.opponentReconnecting(message.display_name)
            : M.opponentBack(message.display_name);
        opponentPresence.textContent = sentence;
        announce(sentence);
        return;
      }
      case 'result':
        startedAt = null;
        openResult(message);
        return;
      case 'error':
        if (message.code === 'LIVE_UNAVAILABLE') {
          notice.textContent = M.liveUnavailable;
          announce(M.liveUnavailable);
          return;
        }
        notice.textContent = noticeFor(new ApiFailure(404, { error: message }));
        return;
      default:
        return;
    }
  }

  function firstEmpty(board: string): Cell {
    for (const target of CELLS) if (boardDigit(board, target) === null) return target;
    return 'r1c1';
  }

  const ticker = setInterval(() => {
    if (startedAt === null) return;
    ui.timer.textContent = formatTime(Math.floor((performance.now() - startedAt) / 1000));
  }, 250);

  const socket = new LiveSocket({
    onOpen: () => socket.send({ type: 'room', code }),
    onMessage: handle,
  });

  ready.addEventListener('click', () => {
    const next = ready.getAttribute('aria-pressed') !== 'true';
    ready.setAttribute('aria-pressed', next ? 'true' : 'false');
    socket.send({ type: 'ready', ready: next });
  });

  document.addEventListener('keydown', onKeydown);
  renderSeats();

  return () => {
    clearInterval(ticker);
    document.removeEventListener('keydown', onKeydown);
    socket.close();
    while (dialogOpen()) closeTopDialog();
  };
}
