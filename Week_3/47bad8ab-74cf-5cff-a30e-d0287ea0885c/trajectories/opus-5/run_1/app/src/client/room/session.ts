import { activeWord, advanceAfterLetter, startingSelection, type Selection } from '../../shared/autoadvance';
import { copy } from '../../shared/copy';
import {
  directionLabel,
  indexInWord,
  layoutGrid,
  wordAt,
  wordSquares,
  type Direction,
  type GridLayout,
  type Word,
} from '../../shared/grid';
import { formatTime } from '../../shared/text';
import type {
  ClueJson,
  Colour,
  GameJson,
  LiveMessage,
  PlayerStat,
  PuzzleJson,
  SquareJson,
} from '../../shared/types';
import { api, ApiFailure } from '../api';
import { attr } from '../dom';
import { app, pageInterval } from '../state';

export interface CursorMark {
  colour: Colour;
  row: number;
  col: number;
}

export interface RoomElements {
  grid: HTMLElement;
  cells: Map<string, HTMLElement>;
  clueBar: HTMLElement;
  clueItems: Map<string, HTMLElement>;
  clueLists: { across: HTMLElement; down: HTMLElement };
  players: HTMLElement;
  timer: HTMLElement;
  announcements: HTMLElement;
  notices: HTMLElement;
  band: HTMLElement;
  teamScores: HTMLElement | null;
  raceRadios: HTMLElement | null;
  startRace: HTMLButtonElement | null;
}

export const key = (row: number, col: number): string => `${row},${col}`;

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export class Room {
  game: GameJson;

  puzzle: PuzzleJson;

  layout: GridLayout;

  you: string;

  squares = new Map<string, SquareJson>();

  cursors = new Map<string, CursorMark>();

  selection: Selection;

  pencil = false;

  personalPause = false;

  rebusOpen = false;

  deadLink: string | null = null;

  elements: RoomElements | null = null;

  private socket: WebSocket | null = null;

  private closed = false;

  private timerValue = { state: 'paused' as 'running' | 'paused' | 'solved', elapsed: 0, at: Date.now() };

  private frozen: number | null = null;

  private noticeSeq = 0;

  private solvedShown = false;

  private raceOverShown = false;

  private reconnectDelay = 500;

  /** Squares shown at once by their own writer, kept until the server answers. */
  private pending = new Map<string, SquareJson>();

  onSolved: ((elapsedMs: number, revealed: number, stats: PlayerStat[]) => void) | null = null;

  onRaceOver: (() => void) | null = null;

  onGameChanged: (() => void) | null = null;

  onPencilChanged: (() => void) | null = null;

  constructor(game: GameJson, puzzle: PuzzleJson, you: string) {
    this.game = game;
    this.puzzle = puzzle;
    this.you = you;
    this.layout = layoutGrid(puzzle.blocks.map((row) => row.split('').map((cell) => cell === '#')));
    this.adoptGame(game);
    this.selection = startingSelection(this.advanceContext());
    this.timerValue = {
      state: game.timer_state,
      elapsed: game.elapsed_ms,
      at: Date.now(),
    };
  }

  setPencil(on: boolean): void {
    this.pencil = on;
    if (this.onPencilChanged) this.onPencilChanged();
  }

  adoptGame(game: GameJson): void {
    this.game = game;
    this.squares = new Map(game.squares.map((square) => [key(square.row, square.col), square]));
    this.timerValue = { state: game.timer_state, elapsed: game.elapsed_ms, at: Date.now() };
  }

  // ---------- derived state ----------

  square(row: number, col: number): SquareJson {
    return (
      this.squares.get(key(row, col)) ?? {
        row,
        col,
        value: '',
        pencil: false,
        state: 'empty',
        owner: null,
      }
    );
  }

  filled(row: number, col: number): boolean {
    return this.square(row, col).value !== '';
  }

  locked(row: number, col: number): boolean {
    const state = this.square(row, col).state;
    return state === 'right' || state === 'revealed';
  }

  get solved(): boolean {
    return this.game.status === 'solved';
  }

  get readOnly(): boolean {
    return this.solved || this.deadLink !== null;
  }

  get watching(): boolean {
    return this.game.mode === 'race' && this.seat?.team == null;
  }

  get seat(): GameJson['players'][number] | undefined {
    return this.game.players.find((player) => player.id === this.you);
  }

  get isHost(): boolean {
    return this.game.host_player_id === this.you;
  }

  get puzzleIsUpload(): boolean {
    return this.puzzle.source === 'upload';
  }

  advanceContext() {
    return {
      layout: this.layout,
      filled: (row: number, col: number) => this.filled(row, col),
      skipFilled: app.settings.skip_filled,
      jumpNextClue: app.settings.jump_next_clue,
    };
  }

  word(selection: Selection = this.selection): Word {
    return activeWord(this.layout, selection);
  }

  clueOf(word: Word): ClueJson {
    const list = word.direction === 'across' ? this.puzzle.clues.across : this.puzzle.clues.down;
    return list.find((clue) => clue.number === word.number) as ClueJson;
  }

  crossingWord(): Word | null {
    return wordAt(
      this.layout,
      this.selection.row,
      this.selection.col,
      this.selection.direction === 'across' ? 'down' : 'across',
    );
  }

  linkedWords(): Word[] {
    const clue = this.clueOf(this.word());
    return clue.links
      .map((ref) =>
        this.layout.words.find(
          (word) => word.number === ref.number && word.direction === ref.direction,
        ),
      )
      .filter((word): word is Word => word !== undefined);
  }

  squareName(row: number, col: number): string {
    const inActive = wordAt(this.layout, row, col, this.selection.direction);
    const word =
      inActive ??
      (wordAt(
        this.layout,
        row,
        col,
        this.selection.direction === 'across' ? 'down' : 'across',
      ) as Word);
    const square = this.square(row, col);
    const content = square.value === '' ? 'empty' : square.value;
    let name = `${word.number} ${directionLabel(word.direction)}, letter ${
      indexInWord(word, row, col) + 1
    } of ${word.length}, ${content}`;
    if (square.pencil) name += ', pencil';
    if (square.state === 'wrong') name += ', checked wrong';
    else if (square.state === 'right') name += ', checked right';
    else if (square.state === 'revealed') name += ', revealed';
    return name;
  }

  // ---------- messages out ----------

  send(message: Record<string, unknown>, revert: SquareJson | null = null): void {
    if (this.deadLink !== null) return;
    const opId = randomId();
    if (revert) this.pending.set(opId, revert);
    const body = { ...message, client_op_id: opId };
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(body));
      return;
    }
    void api
      .write(this.game.id, body)
      .then((broadcast) => this.handle(broadcast as LiveMessage))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) {
          this.handle({
            type: 'error',
            code: failure.body.error,
            message: failure.body.message,
            client_op_id: opId,
          });
        }
      });
  }

  sendCursor(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: 'cursor',
          row: this.selection.row,
          col: this.selection.col,
          direction: this.selection.direction,
        }),
      );
    }
  }

  // ---------- writes ----------

  writeLetter(value: string, pencil: boolean): void {
    const { row, col } = this.selection;
    const allowed = !this.readOnly && !this.locked(row, col) && !this.watching;
    if (this.watching) {
      return;
    }
    const before = { ...this.square(row, col) };
    if (allowed) {
      this.applyLocal({
        row,
        col,
        value,
        pencil,
        state: value === '' ? 'empty' : pencil ? 'pencil' : 'filled',
        owner: value === '' ? null : this.seat?.colour ?? null,
      });
    }
    this.send({ type: 'cell', row, col, value, pencil }, allowed ? before : null);
    const next = advanceAfterLetter(
      {
        ...this.advanceContext(),
        filled: (r: number, c: number) =>
          r === row && c === col ? value !== '' : this.filled(r, c),
      },
      this.selection,
    );
    this.setSelection(next);
  }

  clearSquare(row: number, col: number): void {
    if (this.readOnly || this.locked(row, col) || this.watching) return;
    const before = { ...this.square(row, col) };
    this.applyLocal({ row, col, value: '', pencil: false, state: 'empty', owner: null });
    this.send({ type: 'cell', row, col, value: '', pencil: false }, before);
  }

  applyLocal(square: SquareJson): void {
    this.squares.set(key(square.row, square.col), square);
    this.paintSquare(square.row, square.col);
  }

  // ---------- selection ----------

  setSelection(next: Selection, options: { announce?: boolean } = {}): void {
    const before = this.selection;
    const beforeWord = this.word(before);
    this.selection = next;
    const afterWord = this.word(next);
    const directionChanged = before.direction !== next.direction;
    const clueChanged =
      beforeWord.number !== afterWord.number || beforeWord.direction !== afterWord.direction;
    this.paintSelection();
    if (clueChanged || options.announce) this.announceClue();
    if (directionChanged) this.runPivot();
    if (clueChanged) this.scrollActiveClue();
    this.sendCursor();
  }

  switchDirection(): void {
    const other: Direction = this.selection.direction === 'across' ? 'down' : 'across';
    if (!wordAt(this.layout, this.selection.row, this.selection.col, other)) return;
    this.setSelection({ ...this.selection, direction: other });
  }

  canSwitchDirection(): boolean {
    const other: Direction = this.selection.direction === 'across' ? 'down' : 'across';
    return wordAt(this.layout, this.selection.row, this.selection.col, other) !== null;
  }

  goToWord(word: Word): void {
    const squares = wordSquares(word);
    const empty = squares.find((square) => !this.filled(square.row, square.col));
    const target = empty ?? squares[0];
    this.setSelection({ row: target.row, col: target.col, direction: word.direction });
  }

  stepClue(delta: number): void {
    const order = this.layout.words;
    const current = this.word();
    const index = order.findIndex(
      (word) => word.number === current.number && word.direction === current.direction,
    );
    const next = order[(index + delta + order.length) % order.length];
    this.goToWord(next);
  }

  stepLinkedClue(): void {
    const linked = this.linkedWords();
    if (linked.length === 0) return;
    const order = this.layout.words;
    const current = this.word();
    const index = order.findIndex(
      (word) => word.number === current.number && word.direction === current.direction,
    );
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(index + step) % order.length];
      if (
        linked.some(
          (word) => word.number === candidate.number && word.direction === candidate.direction,
        )
      ) {
        this.goToWord(candidate);
        return;
      }
    }
  }

  // ---------- painting ----------

  paintSquare(row: number, col: number): void {
    const cell = this.elements?.cells.get(key(row, col));
    if (!cell) return;
    const square = this.square(row, col);
    const letter = cell.querySelector('.letter');
    if (letter) letter.textContent = square.value;
    attr(cell, 'data-state', square.state);
    if (this.game.mode === 'race') {
      attr(cell, 'data-claimed', square.state === 'right' ? 'true' : null);
    }
    attr(cell, 'data-owner', square.owner);
    attr(cell, 'aria-label', this.squareName(row, col));
    const cursors = this.game.players
      .filter((player) => {
        if (player.id === this.you) return false;
        const mark = this.cursors.get(player.id);
        return mark !== undefined && mark.row === row && mark.col === col;
      })
      .map((player) => player.colour);
    attr(cell, 'data-cursor', cursors.length > 0 ? cursors.join(' ') : null);
    const marks = cell.querySelector('.cursors');
    if (marks) {
      marks.replaceChildren();
      for (const colour of cursors) {
        const block = document.createElement('span');
        block.className = 'cursor-block';
        block.dataset.colour = colour;
        marks.append(block);
      }
    }
  }

  paintAllSquares(): void {
    for (let row = 0; row < this.puzzle.rows; row += 1) {
      for (let col = 0; col < this.puzzle.cols; col += 1) {
        if (this.puzzle.blocks[row][col] === '#') continue;
        this.paintSquare(row, col);
      }
    }
  }

  paintSelection(): void {
    const elements = this.elements;
    if (!elements) return;
    const word = this.word();
    const inWord = new Set(wordSquares(word).map((square) => key(square.row, square.col)));
    const linked = new Set<string>();
    for (const link of this.linkedWords()) {
      for (const square of wordSquares(link)) linked.add(key(square.row, square.col));
    }
    for (const [cellKey, cell] of elements.cells) {
      attr(cell, 'data-in-word', inWord.has(cellKey) ? 'true' : null);
      attr(cell, 'data-linked', linked.has(cellKey) ? 'true' : null);
      const [row, col] = cellKey.split(',').map(Number);
      const selected = row === this.selection.row && col === this.selection.col;
      attr(cell, 'aria-selected', selected ? 'true' : 'false');
      attr(cell, 'aria-label', this.squareName(row, col));
    }
    attr(elements.grid, 'data-direction', this.selection.direction);
    attr(
      elements.grid,
      'aria-activedescendant',
      `sq-${this.selection.row}-${this.selection.col}`,
    );
    this.paintClues();
    this.paintClueBar();
  }

  paintClues(): void {
    const elements = this.elements;
    if (!elements) return;
    const word = this.word();
    const crossing = this.crossingWord();
    const linked = this.linkedWords();
    for (const [itemKey, item] of elements.clueItems) {
      const [direction, number] = itemKey.split(':');
      const isActive = direction === word.direction && Number(number) === word.number;
      const isCrossing =
        crossing !== null && direction === crossing.direction && Number(number) === crossing.number;
      const isLinked = linked.some(
        (candidate) => candidate.direction === direction && candidate.number === Number(number),
      );
      attr(item, 'aria-current', isActive ? 'true' : null);
      attr(item, 'data-crossing', isCrossing ? 'true' : null);
      attr(item, 'data-linked', isLinked ? 'true' : null);
    }
    attr(
      elements.clueLists.across,
      'data-active',
      word.direction === 'across' ? 'true' : 'false',
    );
    attr(elements.clueLists.down, 'data-active', word.direction === 'down' ? 'true' : 'false');
  }

  paintClueBar(): void {
    const elements = this.elements;
    if (!elements) return;
    const word = this.word();
    const clue = this.clueOf(word);
    const text = elements.clueBar.querySelector('.clue-text');
    if (text) {
      text.textContent = `${word.number}${word.direction === 'across' ? 'A' : 'D'} ${clue.text}`;
    }
  }

  paintPlayers(): void {
    const elements = this.elements;
    if (!elements) return;
    elements.players.replaceChildren();
    for (const player of this.game.players) {
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.className = 'tile player-tile';
      item.dataset.colour = player.colour;
      const name = document.createElement('p');
      name.className = 'player-name';
      name.textContent = player.display_name;
      const line = document.createElement('p');
      line.className = 'player-line';
      line.textContent = `${player.colour} · ${player.present ? 'Here' : 'Away'}${
        player.host ? ' · Host' : ''
      }`;
      item.append(name, line);
      elements.players.append(item);
    }
  }

  paintTimer(): void {
    const elements = this.elements;
    if (!elements) return;
    const value =
      this.frozen !== null
        ? this.frozen
        : this.timerValue.elapsed +
          (this.timerValue.state === 'running' ? Date.now() - this.timerValue.at : 0);
    elements.timer.textContent = formatTime(value);
    attr(elements.timer, 'data-timer-state', this.timerValue.state);
  }

  elapsedNow(): number {
    return (
      this.timerValue.elapsed +
      (this.timerValue.state === 'running' ? Date.now() - this.timerValue.at : 0)
    );
  }

  togglePersonalPause(): boolean {
    this.personalPause = !this.personalPause;
    this.frozen = this.personalPause ? this.elapsedNow() : null;
    this.paintTimer();
    return this.personalPause;
  }

  // ---------- announcements and notices ----------

  announce(text: string): void {
    if (this.elements) this.elements.announcements.textContent = text;
  }

  announceClue(): void {
    const word = this.word();
    const clue = this.clueOf(word);
    let text = copy.clueChanged(word.number, word.direction, clue.text, word.length);
    if (clue.links.length > 0) text += ` ${copy.linkedTo(clue.links)}`;
    this.announce(text);
  }

  notice(text: string): void {
    const elements = this.elements;
    if (!elements) return;
    this.noticeSeq += 1;
    const mine = this.noticeSeq;
    elements.notices.textContent = text;
    window.setTimeout(() => {
      if (this.noticeSeq === mine && this.elements) this.elements.notices.textContent = '';
    }, app.config.toast_ms);
  }

  showBand(text: string | null): void {
    const elements = this.elements;
    if (!elements) return;
    elements.band.textContent = text ?? '';
    elements.band.hidden = text === null;
  }

  // ---------- motion ----------

  private runPivot(): void {
    const elements = this.elements;
    if (!elements) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      attr(elements.grid, 'data-pivot', 'idle');
      return;
    }
    attr(elements.grid, 'data-pivot', 'shrink');
    window.clearTimeout(this.pivotTimer);
    this.pivotTimer = window.setTimeout(() => {
      attr(elements.grid, 'data-pivot', 'grow');
      this.pivotTimer = window.setTimeout(() => {
        attr(elements.grid, 'data-pivot', 'idle');
      }, 140);
    }, 90);
  }

  private pivotTimer = 0;

  private scrollActiveClue(): void {
    const elements = this.elements;
    if (!elements) return;
    const word = this.word();
    const item = elements.clueItems.get(`${word.direction}:${word.number}`);
    const list = word.direction === 'across' ? elements.clueLists.across : elements.clueLists.down;
    if (!item || !list) return;
    const target = item.offsetTop - list.clientHeight / 3;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: Math.max(0, target), behavior: reduced ? 'auto' : 'smooth' });
  }

  // ---------- live ----------

  connect(): void {
    if (this.closed) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${protocol}://${location.host}/api/games/${this.game.id}/live`,
    );
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.reconnectDelay = 500;
      this.showBand(this.deadLink);
      this.sendCursor();
    });
    socket.addEventListener('message', (event) => {
      this.handle(JSON.parse(String(event.data)) as LiveMessage);
    });
    socket.addEventListener('close', (event) => {
      this.socket = null;
      if (this.closed || event.code === 4410) return;
      this.showBand(copy.connectionLost);
      window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(4000, this.reconnectDelay * 2);
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  startTicking(): void {
    pageInterval(() => this.paintTimer(), 1000);
  }

  private handle(message: LiveMessage): void {
    switch (message.type) {
      case 'hello': {
        const selection = this.selection;
        this.adoptGame(message.game);
        this.selection = selection;
        this.paintAllSquares();
        this.paintSelection();
        this.paintPlayers();
        this.paintTimer();
        if (this.onGameChanged) this.onGameChanged();
        break;
      }
      case 'cell': {
        if (message.client_op_id) this.pending.delete(message.client_op_id);
        this.squares.set(key(message.row, message.col), {
          row: message.row,
          col: message.col,
          value: message.value,
          pencil: message.pencil,
          state: message.state,
          owner: message.owner,
        });
        this.paintSquare(message.row, message.col);
        break;
      }
      case 'check': {
        for (const square of message.squares) {
          const current = this.square(square.row, square.col);
          this.squares.set(key(square.row, square.col), {
            ...current,
            state: square.state,
            pencil: square.state === 'right' ? false : current.pencil,
          });
          this.paintSquare(square.row, square.col);
        }
        if (message.by === this.you) {
          this.announce(copy.checkResult(message.wrong, message.scope));
        }
        break;
      }
      case 'reveal': {
        for (const square of message.squares) {
          this.squares.set(key(square.row, square.col), {
            row: square.row,
            col: square.col,
            value: square.value,
            pencil: false,
            state: 'revealed',
            owner: square.owner,
          });
          this.paintSquare(square.row, square.col);
        }
        if (message.by === this.you) this.announce(copy.revealResult(message.revealed));
        break;
      }
      case 'clear': {
        for (const square of message.squares) {
          this.squares.set(key(square.row, square.col), {
            row: square.row,
            col: square.col,
            value: '',
            pencil: false,
            state: 'empty',
            owner: null,
          });
          this.paintSquare(square.row, square.col);
        }
        if (message.by === this.you) this.announce(copy.clearResult(message.cleared));
        break;
      }
      case 'claim': {
        this.squares.set(key(message.row, message.col), {
          row: message.row,
          col: message.col,
          value: message.value,
          pencil: false,
          state: 'right',
          owner: message.owner,
        });
        this.paintSquare(message.row, message.col);
        this.game.scores = message.scores;
        const seat = this.game.players.find((player) => player.id === message.by);
        if (seat) seat.score += 1;
        if (this.onGameChanged) this.onGameChanged();
        break;
      }
      case 'cursor': {
        const before = this.cursors.get(message.player_id);
        this.cursors.set(message.player_id, {
          colour: message.colour,
          row: message.row,
          col: message.col,
        });
        if (before) this.paintSquare(before.row, before.col);
        this.paintSquare(message.row, message.col);
        break;
      }
      case 'presence': {
        if (!message.present) {
          const mark = this.cursors.get(message.player_id);
          this.cursors.delete(message.player_id);
          if (mark) this.paintSquare(mark.row, mark.col);
        }
        const player = this.game.players.find((candidate) => candidate.id === message.player_id);
        if (player) player.present = message.present;
        else
          this.game.players.push({
            id: message.player_id,
            display_name: message.display_name,
            colour: message.colour,
            host: false,
            present: message.present,
            team: null,
            score: 0,
          });
        this.paintPlayers();
        this.announce(
          message.present ? copy.playerJoined(message.display_name) : copy.playerLeft(message.display_name),
        );
        break;
      }
      case 'timer': {
        this.timerValue = { state: message.state, elapsed: message.elapsed_ms, at: Date.now() };
        this.game.timer_state = message.state;
        this.paintTimer();
        break;
      }
      case 'solved': {
        this.game.status = 'solved';
        this.game.timer_state = 'solved';
        this.timerValue = { state: 'solved', elapsed: message.elapsed_ms, at: Date.now() };
        this.paintTimer();
        this.announce(copy.solvedAnnouncement(message.elapsed_ms));
        if (!this.solvedShown && this.onSolved) {
          this.solvedShown = true;
          this.onSolved(message.elapsed_ms, message.revealed_count, message.stats);
        }
        break;
      }
      case 'team': {
        const player = this.game.players.find((candidate) => candidate.id === message.player_id);
        if (player) player.team = message.team;
        if (this.onGameChanged) this.onGameChanged();
        break;
      }
      case 'race': {
        this.game.race_state = message.state === 'racing' ? 'racing' : 'finished';
        this.game.scores = message.scores;
        if (message.state === 'finished') {
          this.game.status = 'solved';
          if (!this.raceOverShown && this.onRaceOver) {
            this.raceOverShown = true;
            this.onRaceOver();
          }
        }
        if (this.onGameChanged) this.onGameChanged();
        break;
      }
      case 'error': {
        const reverted = message.client_op_id ? this.pending.get(message.client_op_id) : undefined;
        if (reverted) {
          this.pending.delete(message.client_op_id as string);
          this.applyLocal(reverted);
        }
        if (message.code === 'square_locked') this.notice(copy.squareLocked);
        else if (message.code === 'game_solved') this.notice(copy.alreadySolved);
        else if (message.code === 'rate_limited') this.notice(copy.rateLimited);
        else if (message.code === 'race_not_started') this.notice(copy.raceNotStarted);
        else this.notice(message.message);
        break;
      }
      case 'link_off': {
        this.deadLink = message.message;
        this.showBand(message.message);
        if (this.onGameChanged) this.onGameChanged();
        break;
      }
      default:
        break;
    }
  }

  async refreshGame(): Promise<void> {
    const game = await api.game(this.game.id);
    const selection = this.selection;
    this.adoptGame(game);
    this.selection = selection;
    this.paintAllSquares();
    this.paintSelection();
    this.paintPlayers();
    this.paintTimer();
  }
}
