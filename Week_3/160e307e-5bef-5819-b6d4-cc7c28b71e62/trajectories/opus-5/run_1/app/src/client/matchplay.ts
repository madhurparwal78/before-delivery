import type { MatchJson, ShotResultJson } from './api.js';
import { RENDERED_SIDE, setDanger, strikerShape } from './board.js';
import type { BoardSkins } from './board.js';
import { EMOTE_LABELS, PLACEMENT_ILLEGAL, RULES_SUMMARY, SHOT_ERRORS } from './copy.js';
import { el, mmss, oneDecimal, reducedMotion, trapFocus } from './dom.js';
import { buildMatchDom } from './matchdom.js';
import type { MatchDom } from './matchdom.js';
import { state } from './store.js';
import { openDialog } from './ui.js';
import {
  BASELINE_MAX_OFFSET,
  aimDirection,
  baselineY,
  offsetToBoardX,
  otherSeat,
  round1,
  round3,
} from '../shared/geometry.js';
import { boardLabel, coinsLeftText, placementLegal, queenStatusText } from '../shared/laws.js';
import { guideFrom } from '../shared/shot.js';
import type { BoardState, Intent, Piece, Seat } from '../shared/types.js';

const MAX_PULL_FRACTION = 0.4;
const CANCEL_RADIUS = 8;
const MIN_REFEREE_MS = 140;
const RAIL_COLUMN_WIDTH_BREAKPOINT = 1280;
const RAIL_COLUMN_WIDTH = 300;
const OUTSIDE_BOARD_SPACE = 44;

export interface MatchHooks {
  local: boolean;
  mySeat: Seat | null;
  turnBoard: boolean;
  privateRoom: boolean;
  shoot: (intent: Intent, shotSeq: number) => void;
  preview: (intent: Intent) => void;
  resign: () => void;
  rematch?: (accept: boolean) => void;
  emote?: (emote: string) => void;
  onMatchOver?: (dialog: HTMLElement) => void;
}

interface Pull {
  pointerId: number;
  kind: 'striker' | 'pull';
  startX: number;
  startY: number;
  startOffset: number;
}

export class MatchPlay {
  readonly dom: MatchDom;
  private match: MatchJson;
  private offset = 0;
  private angle = 0;
  private power = 0;
  private legal = true;
  private drag: Pull | null = null;
  private verdictTimer: number | null = null;
  private verdictLeave: number | null = null;
  private clockTimer: number | null = null;
  private animation: number | null = null;
  private jumpToEnd: (() => void) | null = null;
  private pendingMatch: MatchJson | null = null;
  private pendingPoints: string | null = null;
  private lastAnnouncedIllegal = false;
  private rotation: 0 | 180 = 0;
  private emoteTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private announcedReconnect = '';
  private frozenPieces: Piece[] | null = null;
  private matchOverShown = false;

  constructor(
    match: MatchJson,
    private readonly hooks: MatchHooks,
    skins: BoardSkins,
  ) {
    this.match = match;
    this.dom = buildMatchDom(skins, !hooks.local);
    this.wireControls();
    this.wirePointer();
    this.wireKeys();
    this.setState(match, true);
    window.addEventListener('resize', this.sizeBoard);
  }

  destroy(): void {
    window.removeEventListener('resize', this.sizeBoard);
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    if (this.verdictTimer !== null) window.clearTimeout(this.verdictTimer);
    if (this.verdictLeave !== null) window.clearTimeout(this.verdictLeave);
    if (this.animation !== null) window.cancelAnimationFrame(this.animation);
    if (this.emoteTimer !== null) window.clearTimeout(this.emoteTimer);
    if (this.reconnectTimer !== null) window.clearInterval(this.reconnectTimer);
    if (this.previewTrailing !== null) window.clearTimeout(this.previewTrailing);
  }

  /* Layout */

  /** The whole square board stays in view at every published size, without scrolling. */
  private sizeBoard = (): void => {
    const root = this.dom.root;
    const wide = window.innerWidth >= RAIL_COLUMN_WIDTH_BREAKPOINT;
    const widthBudget = wide ? root.clientWidth - 24 - RAIL_COLUMN_WIDTH - 24 : root.clientWidth - 24;
    root.style.setProperty('--board-size', `${Math.floor(widthBudget)}px`);
    const railHeight = this.dom.rail.offsetHeight;
    const controlsHeight = this.dom.controls.offsetHeight;
    const used = controlsHeight + (wide ? 0 : railHeight) + OUTSIDE_BOARD_SPACE;
    const size = Math.max(220, Math.min(widthBudget, window.innerHeight - used));
    root.style.setProperty('--board-size', `${Math.floor(size)}px`);
  };

  /* State */

  private boardState(): BoardState {
    const pieces: Piece[] = this.match.pieces
      .filter((piece) => piece.id !== 'striker')
      .map((piece) => ({
        id: piece.id,
        x: piece.x,
        y: piece.y,
        state: piece.state,
        pocketedBy: piece.pocketedBy,
      }));
    return {
      board: this.match.board,
      turn: this.match.turn,
      whiteSeat: this.match.seats[0].color === 'white' ? 0 : 1,
      breakAttempt: this.match.breakAttempt,
      pieces: this.frozenPieces ?? pieces,
      queen: this.match.queen,
      dues: [this.match.seats[0].dues, this.match.seats[1].dues],
      scores: [this.match.seats[0].score, this.match.seats[1].score],
    };
  }

  private shooterSeat(): Seat {
    return this.match.turn;
  }

  private viewerShoots(): boolean {
    if (this.hooks.local) return true;
    return this.hooks.mySeat === this.match.turn;
  }

  private alignedFor(seat: Seat): boolean {
    return (seat === 0) === (this.rotation === 0);
  }

  setState(match: MatchJson, resetAim = false): void {
    this.match = match;
    this.frozenPieces = null;
    const root = this.dom.root;
    root.dataset.turn = String(match.turn);
    root.dataset.field = match.turn === 0 ? 'tomato' : 'cobalt';
    root.dataset.board = String(match.board);
    root.dataset.shotSeq = String(match.shotSeq);
    if (match.status === 'active') root.dataset.phase = 'aim';
    else if (match.status === 'waiting') root.dataset.phase = 'waiting';
    else root.dataset.phase = 'match-over';

    this.rotation = this.hooks.local
      ? this.hooks.turnBoard && match.turn === 1
        ? 180
        : 0
      : this.hooks.mySeat === 1
        ? 180
        : 0;
    this.dom.rotator.dataset.rotation = String(this.rotation);

    if (resetAim) {
      this.offset = 0;
      this.angle = 0;
      this.power = 0;
    }
    this.paintRail();
    this.paintPieces();
    this.paintAim();
    this.startClock();
    this.syncReconnect();
    this.sizeBoard();
    window.requestAnimationFrame(this.sizeBoard);
  }

  private paintRail(): void {
    const match = this.match;
    const names: [string, string] = [match.seats[0].name, match.seats[1].name];
    for (const index of [0, 1] as const) {
      const seat = match.seats[index];
      this.dom.names[index].textContent = seat.name;
      this.dom.scores[index].textContent = String(seat.score);
      this.dom.coins[index].textContent = coinsLeftText(seat.coinsLeft);
      this.dom.dues[index].textContent = `Dues owed: ${seat.dues}`;
      this.dom.railSeats[index].dataset.active = String(match.turn === index);
    }
    this.dom.queenStatus.textContent = queenStatusText(match.queen, names);
    this.dom.boardLabel.textContent = boardLabel(match.format, match.board);
    this.dom.breakLabel.textContent =
      match.breakAttempt === null ? '' : `Break attempt ${match.breakAttempt} of 3`;
    this.dom.turnText.textContent = this.hooks.local
      ? `${names[match.turn]}'s turn`
      : this.viewerShoots()
        ? 'Your turn'
        : `${names[match.turn]}'s turn`;
    const opponentIndex = this.hooks.local ? otherSeat(match.turn) : otherSeat(this.hooks.mySeat ?? 0);
    this.dom.crop.textContent = names[opponentIndex];
  }

  private paintPieces(): void {
    const shooter = this.shooterSeat();
    for (const piece of this.match.pieces) {
      if (piece.id === 'striker') continue;
      const node = this.dom.handles.pieces.get(piece.id);
      if (node === undefined) continue;
      this.placeNode(node, piece.x, piece.y, piece.state, piece.pocketedBy);
    }
    const striker = this.dom.handles.striker;
    const x = offsetToBoardX(this.offset, shooter);
    const y = baselineY(shooter);
    striker.setAttribute('transform', `translate(${x} ${y})`);
    striker.dataset.x = oneDecimal(x);
    striker.dataset.y = oneDecimal(y);
    striker.dataset.state = 'board';
    striker.dataset.skin = this.match.seats[shooter].strikerSkin;
    this.refreshStrikerSkin(this.match.seats[shooter].strikerSkin);
  }

  private currentSkin = '';

  private refreshStrikerSkin(skin: string): void {
    if (skin === this.currentSkin) return;
    this.currentSkin = skin;
    const replacement = strikerShape(skin);
    const node = this.dom.handles.striker;
    while (node.firstChild !== null) node.firstChild.remove();
    while (replacement.group.firstChild !== null) node.append(replacement.group.firstChild);
    this.dom.handles.strikerOutline = replacement.outline;
  }

  private placeNode(
    node: SVGGElement,
    x: number | null,
    y: number | null,
    pieceState: 'board' | 'pocketed',
    pocketedBy: 0 | 1 | null,
  ): void {
    node.dataset.pocketedBy = pocketedBy === null ? '' : String(pocketedBy);
    if (pieceState === 'pocketed' || x === null || y === null) {
      node.dataset.state = 'pocketed';
      node.dataset.x = '';
      node.dataset.y = '';
      node.setAttribute('opacity', '0');
      return;
    }
    node.dataset.state = 'board';
    node.dataset.x = oneDecimal(x);
    node.dataset.y = oneDecimal(y);
    node.setAttribute('opacity', '1');
    node.setAttribute('transform', `translate(${x} ${y})`);
  }

  /* Aiming */

  private clampOffset(value: number): number {
    const snapped = Math.round(value / 0.5) * 0.5;
    return Math.max(-BASELINE_MAX_OFFSET, Math.min(BASELINE_MAX_OFFSET, round1(snapped)));
  }

  private paintAim(): void {
    const shooter = this.shooterSeat();
    const percent = Math.round(this.power * 100);
    this.dom.strikerReadout.textContent = `Striker ${oneDecimal(this.offset)} mm`;
    this.dom.aimReadout.textContent = `Aim ${oneDecimal(this.angle)} degrees`;
    this.dom.powerReadout.textContent = `Power ${percent}%`;
    this.dom.strikerSlider.value = String(this.offset);
    this.dom.strikerSlider.setAttribute('aria-valuetext', `${oneDecimal(this.offset)} mm`);
    this.dom.aimSlider.value = String(round1(this.angle));
    this.dom.aimSlider.setAttribute('aria-valuetext', `${oneDecimal(this.angle)} degrees`);
    this.dom.powerSlider.value = String(percent);
    this.dom.powerSlider.setAttribute('aria-valuetext', `${percent}%`);

    this.paintPieces();
    const legal = placementLegal(this.offset, shooter, this.boardState().pieces);
    const entered = legal === false && this.legal === true;
    this.legal = legal;
    this.dom.handles.striker.dataset.legal = legal ? 'true' : 'false';
    setDanger(this.dom.handles.strikerOutline, !legal);
    this.dom.placementMessage.textContent = legal ? '' : PLACEMENT_ILLEGAL;
    if (entered) {
      if (!reducedMotion()) {
        this.dom.handles.strikerOutline.classList.remove('shake');
        void this.dom.handles.strikerOutline.getBoundingClientRect();
        this.dom.handles.strikerOutline.classList.add('shake');
      }
      if (!this.lastAnnouncedIllegal) this.announce(PLACEMENT_ILLEGAL);
      this.lastAnnouncedIllegal = true;
    }
    if (legal) this.lastAnnouncedIllegal = false;

    this.paintGuide();
    this.updateControls();
    this.sendPreview();
  }

  private paintGuide(): void {
    const shooter = this.shooterSeat();
    const guide = this.dom.handles.aimGuide;
    if (!this.viewerShoots() || this.dom.root.dataset.phase !== 'aim') {
      guide.setAttribute('display', 'none');
      guide.removeAttribute('data-first-contact');
      return;
    }
    const direction = aimDirection(this.angle, shooter);
    const contact = guideFrom(this.boardState(), shooter, this.offset, direction);
    guide.removeAttribute('display');
    guide.dataset.firstContact = contact;
    const x = offsetToBoardX(this.offset, shooter);
    const y = baselineY(shooter);
    const length = 740;
    for (const line of guide.children) {
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(x + direction.dx * length));
      line.setAttribute('y2', String(y + direction.dy * length));
    }
  }

  private updateControls(): void {
    const aiming = this.dom.root.dataset.phase === 'aim';
    const enabled = aiming && this.viewerShoots();
    this.dom.shoot.disabled = !(enabled && this.power > 0 && this.legal);
    for (const slider of [this.dom.strikerSlider, this.dom.aimSlider, this.dom.powerSlider]) {
      slider.disabled = !enabled;
    }
    if (this.hooks.emote !== undefined) this.dom.emotes.disabled = this.match.status !== 'active';
  }

  private previewAt = 0;
  private previewTrailing: number | null = null;

  /** Previews go out at most 15 times a second, with the last aim always sent. */
  private sendPreview(): void {
    if (this.hooks.local || !this.viewerShoots()) return;
    const now = performance.now();
    const wait = 70 - (now - this.previewAt);
    if (wait > 0) {
      if (this.previewTrailing !== null) return;
      this.previewTrailing = window.setTimeout(() => {
        this.previewTrailing = null;
        this.previewAt = performance.now();
        this.hooks.preview(this.intent());
      }, wait);
      return;
    }
    if (this.previewTrailing !== null) {
      window.clearTimeout(this.previewTrailing);
      this.previewTrailing = null;
    }
    this.previewAt = now;
    this.hooks.preview(this.intent());
  }

  private intent(): Intent {
    const shooter = this.shooterSeat();
    const direction = aimDirection(this.angle, shooter);
    return { seat: shooter, x: this.offset, dx: direction.dx, dy: direction.dy, p: round3(this.power) };
  }

  setOffset(value: number): void {
    this.offset = this.clampOffset(value);
    this.paintAim();
  }

  setAngle(value: number): void {
    this.angle = round1(Math.max(-180, Math.min(180, value)));
    this.paintAim();
  }

  setPower(value: number): void {
    this.power = Math.max(0, Math.min(1, round3(value)));
    this.paintAim();
  }

  /* Controls */

  private wireControls(): void {
    this.dom.strikerSlider.addEventListener('input', () => this.setOffset(Number(this.dom.strikerSlider.value)));
    this.dom.aimSlider.addEventListener('input', () => this.setAngle(Number(this.dom.aimSlider.value)));
    this.dom.powerSlider.addEventListener('input', () => this.setPower(Number(this.dom.powerSlider.value) / 100));
    this.dom.shoot.addEventListener('click', () => this.fire());
    this.dom.skipShot.addEventListener('click', () => this.jumpToEnd?.());
    this.dom.menu.addEventListener('click', () => this.openMenu());
    if (this.hooks.emote !== undefined) {
      this.dom.emotes.addEventListener('click', () => this.openEmotes());
    }
  }

  private wireKeys(): void {
    this.dom.root.addEventListener('keydown', (event) => {
      if (document.querySelector('dialog[open]') !== null) return;
      const target = event.target as HTMLElement | null;
      const onBoard = target === this.dom.board;
      const onButton = target instanceof HTMLButtonElement;
      const aiming = this.dom.root.dataset.phase === 'aim' && this.viewerShoots();

      if (event.key === 'Escape' && (onBoard || onButton)) {
        event.preventDefault();
        this.angle = 0;
        this.power = 0;
        this.paintAim();
        return;
      }
      if ((event.key === 'k' || event.key === 'K') && (onBoard || onButton)) {
        event.preventDefault();
        this.jumpToEnd?.();
        return;
      }
      if (!aiming) return;

      if (onBoard) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const step = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.5 : 1);
          this.setOffset(this.offset + step);
          return;
        }
        if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          this.fire();
          return;
        }
      }
      if (!onBoard && !onButton) return;
      const letter = event.key.toLowerCase();
      if (letter === 'a' || letter === 'd') {
        event.preventDefault();
        const step = (letter === 'd' ? 1 : -1) * (event.shiftKey ? 0.1 : 1);
        this.setAngle(this.angle + step);
        return;
      }
      if (letter === 'w' || letter === 's') {
        event.preventDefault();
        this.setPower(this.power + (letter === 'w' ? 0.02 : -0.02));
      }
    });
  }

  private boardScale(): number {
    const rect = this.dom.board.getBoundingClientRect();
    return rect.width === 0 ? 1 : RENDERED_SIDE / rect.width;
  }

  private wirePointer(): void {
    const board = this.dom.board;
    board.addEventListener('pointerdown', (event) => {
      if (this.dom.root.dataset.phase !== 'aim' || !this.viewerShoots()) return;
      try {
        board.setPointerCapture(event.pointerId);
      } catch {
        /* a pointer that is already released needs no capture */
      }
      const rect = board.getBoundingClientRect();
      const scale = this.boardScale();
      const aligned = this.alignedFor(this.shooterSeat());
      const localX = (event.clientX - rect.left - rect.width / 2) * scale * (aligned ? 1 : -1);
      const localY = (event.clientY - rect.top - rect.height / 2) * scale * (aligned ? 1 : -1);
      const strikerX = offsetToBoardX(this.offset, this.shooterSeat());
      const strikerY = baselineY(this.shooterSeat());
      const onStriker = Math.hypot(localX - strikerX, localY - strikerY) <= 26;
      this.drag = {
        pointerId: event.pointerId,
        kind: onStriker ? 'striker' : 'pull',
        startX: event.clientX,
        startY: event.clientY,
        startOffset: this.offset,
      };
      event.preventDefault();
    });

    board.addEventListener('pointermove', (event) => {
      const drag = this.drag;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const scale = this.boardScale();
      const aligned = this.alignedFor(this.shooterSeat());
      if (drag.kind === 'striker') {
        const deltaPx = (event.clientX - drag.startX) * (aligned ? 1 : -1);
        this.setOffset(drag.startOffset + deltaPx * scale);
        return;
      }
      const rect = board.getBoundingClientRect();
      const maxPull = MAX_PULL_FRACTION * rect.width;
      const pullX = drag.startX - event.clientX;
      const pullY = drag.startY - event.clientY;
      const distance = Math.hypot(pullX, pullY);
      if (distance <= CANCEL_RADIUS) {
        this.power = 0;
        this.paintAim();
        return;
      }
      const sign = aligned ? 1 : -1;
      this.angle = round1((Math.atan2(pullX * sign, -pullY * sign) * 180) / Math.PI);
      this.power = Math.max(0, Math.min(1, round3((distance / maxPull) ** 2)));
      this.paintAim();
    });

    const release = (event: PointerEvent): void => {
      const drag = this.drag;
      if (drag === null || drag.pointerId !== event.pointerId) return;
      this.drag = null;
      try {
        if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
      if (drag.kind === 'pull' && this.power > 0 && this.legal) this.fire();
    };
    board.addEventListener('pointerup', release);
    board.addEventListener('pointercancel', (event) => {
      if (this.drag?.pointerId === event.pointerId) this.drag = null;
    });
  }

  private refereeStart = 0;

  private fire(): void {
    if (this.dom.root.dataset.phase !== 'aim' || !this.viewerShoots()) return;
    if (this.power <= 0 || !this.legal) return;
    this.dom.shotError.textContent = '';
    this.refereeStart = performance.now();
    this.dom.root.dataset.phase = 'refereeing';
    this.dom.handles.aimGuide.setAttribute('display', 'none');
    this.dom.handles.striker.setAttribute('opacity', '0.45');
    this.updateControls();
    this.hooks.shoot(this.intent(), this.match.shotSeq + 1);
  }

  showShotError(code: string): void {
    const message = SHOT_ERRORS[code];
    if (message === undefined) return;
    this.dom.shotError.textContent = message;
    this.announce(message);
    this.dom.handles.striker.setAttribute('opacity', '1');
    this.dom.root.dataset.phase = 'aim';
    this.paintAim();
  }

  /* Verdict swap */

  applyShotResult(result: ShotResultJson): void {
    const waited = performance.now() - this.refereeStart;
    if (this.dom.root.dataset.phase === 'refereeing' && waited < MIN_REFEREE_MS) {
      window.setTimeout(() => this.applyShotResult(result), MIN_REFEREE_MS - waited);
      return;
    }
    const beforeTurn = this.match.turn;
    this.dom.root.dataset.phase = 'moving';
    this.dom.root.dataset.shotSeq = String(result.shotSeq);
    this.dom.handles.striker.setAttribute('opacity', '1');
    this.dom.handles.aimGuide.setAttribute('display', 'none');
    this.updateControls();
    this.dom.skipShot.hidden = reducedMotion();

    const finish = (): void => {
      this.dom.skipShot.hidden = true;
      this.paintFinal(result);
      this.afterMotion(result, beforeTurn);
    };

    if (reducedMotion() || result.frames.length <= 1) {
      finish();
      return;
    }
    this.playFrames(result, finish);
  }

  private playFrames(result: ShotResultJson, done: () => void): void {
    const frames = result.frames;
    const simDuration = frames[frames.length - 1].t;
    const wall = Math.min(2.4, Math.max(0.25, simDuration / 2)) * 1000;
    const started = performance.now();
    let finished = false;

    const stop = (): void => {
      if (finished) return;
      finished = true;
      if (this.animation !== null) window.cancelAnimationFrame(this.animation);
      this.animation = null;
      this.jumpToEnd = null;
      done();
    };
    this.jumpToEnd = stop;

    const step = (now: number): void => {
      if (finished) return;
      const progress = Math.min(1, (now - started) / wall);
      const simTime = progress * simDuration;
      let index = 0;
      while (index + 1 < frames.length && frames[index + 1].t <= simTime) index += 1;
      this.paintFrame(frames[index], result);
      if (progress >= 1) {
        stop();
        return;
      }
      this.animation = window.requestAnimationFrame(step);
    };
    this.animation = window.requestAnimationFrame(step);
  }

  private paintFrame(frame: { pieces: { id: string; x: number; y: number }[] }, result: ShotResultJson): void {
    const present = new Set(frame.pieces.map((piece) => piece.id));
    for (const piece of frame.pieces) {
      if (piece.id === 'striker') {
        const striker = this.dom.handles.striker;
        striker.setAttribute('transform', `translate(${piece.x} ${piece.y})`);
        striker.dataset.x = oneDecimal(piece.x);
        striker.dataset.y = oneDecimal(piece.y);
        striker.setAttribute('opacity', '1');
        continue;
      }
      const node = this.dom.handles.pieces.get(piece.id);
      if (node === undefined) continue;
      node.setAttribute('transform', `translate(${piece.x} ${piece.y})`);
      node.dataset.x = oneDecimal(piece.x);
      node.dataset.y = oneDecimal(piece.y);
      node.dataset.state = 'board';
      node.setAttribute('opacity', '1');
    }
    for (const entry of result.events.pocketed) {
      if (present.has(entry.id)) continue;
      const node = entry.id === 'striker' ? this.dom.handles.striker : this.dom.handles.pieces.get(entry.id);
      node?.setAttribute('opacity', '0');
    }
  }

  private paintFinal(result: ShotResultJson): void {
    for (const entry of result.final) {
      if (entry.id === 'striker') {
        const striker = this.dom.handles.striker;
        const x = entry.x ?? 0;
        const y = entry.y ?? 0;
        striker.setAttribute('transform', `translate(${x} ${y})`);
        striker.dataset.x = oneDecimal(x);
        striker.dataset.y = oneDecimal(y);
        striker.dataset.state = 'board';
        striker.setAttribute('opacity', '1');
        continue;
      }
      const node = this.dom.handles.pieces.get(entry.id);
      if (node === undefined) continue;
      const owner = result.match.pieces.find((piece) => piece.id === entry.id)?.pocketedBy ?? null;
      this.placeNode(node, entry.x, entry.y, entry.state, owner);
    }
  }

  private afterMotion(result: ShotResultJson, beforeTurn: Seat): void {
    this.showVerdict(result.verdict.word, result.verdict.line);
    this.announce(result.verdict.line);
    this.frozenPieces = result.final
      .filter((entry) => entry.id !== 'striker')
      .map((entry) => ({
        id: entry.id,
        x: entry.x,
        y: entry.y,
        state: entry.state,
        pocketedBy: result.match.pieces.find((piece) => piece.id === entry.id)?.pocketedBy ?? null,
      }));

    for (const index of [0, 1] as const) {
      const seat = result.match.seats[index];
      this.dom.scores[index].textContent = String(seat.score);
      this.dom.dues[index].textContent = `Dues owed: ${seat.dues}`;
      this.dom.coins[index].textContent = coinsLeftText(seat.coinsLeft);
    }
    this.dom.queenStatus.textContent = queenStatusText(result.match.queen, [
      result.match.seats[0].name,
      result.match.seats[1].name,
    ]);

    const outcome = result.boardOutcome;
    const ended = result.match.status !== 'active' && result.match.status !== 'waiting';

    if (outcome !== null) {
      const winnerName = result.match.seats[outcome.winnerSeat].name;
      this.announce(`${winnerName} wins board ${this.match.board}. ${outcome.pointsLine}`);
    }

    if (ended) {
      this.dom.root.dataset.phase = 'match-over';
      this.pendingPoints = outcome?.pointsLine ?? null;
      this.match = result.match;
      this.openMatchOver(result.match, this.pendingPoints);
      return;
    }

    if (outcome !== null) {
      this.pendingMatch = result.match;
      this.pendingPoints = outcome.pointsLine;
      this.openBoardOver(result.match, outcome.winnerSeat, this.match.board, outcome.pointsLine);
      return;
    }

    const turnPasses = result.match.turn !== beforeTurn;
    if (!turnPasses) {
      this.dom.root.classList.add('pulse');
      window.setTimeout(() => this.dom.root.classList.remove('pulse'), 260);
      this.setState(result.match, true);
      this.announceTurn(result.match);
      return;
    }
    this.wipeTo(result.match, result.match.turn);
  }

  /** The field wipe starts from the incoming shooter's baseline edge. */
  private wipeTo(next: MatchJson, incoming: Seat): void {
    const apply = (): void => {
      const before = this.rotation;
      this.setState(next, true);
      if (reducedMotion() && this.rotation !== before) {
        const rotator = this.dom.rotator;
        rotator.classList.add('crossfade');
        window.setTimeout(() => rotator.classList.remove('crossfade'), 160);
      }
      this.announceTurn(next);
    };
    if (reducedMotion()) {
      apply();
      return;
    }
    const wipe = el('div', {
      id: 'field-wipe',
      'data-from': this.alignedFor(incoming) ? 'bottom' : 'top',
      style: `background:${incoming === 0 ? 'var(--tomato)' : 'var(--cobalt)'}`,
    });
    this.dom.crop.textContent =
      next.seats[this.hooks.local ? otherSeat(incoming) : otherSeat(this.hooks.mySeat ?? 0)].name;
    this.dom.root.append(wipe);
    window.setTimeout(() => {
      wipe.remove();
      apply();
    }, 520);
  }

  private announceTurn(match: MatchJson): void {
    const line = this.hooks.local
      ? `${match.seats[match.turn].name}'s turn`
      : match.turn === this.hooks.mySeat
        ? 'Your turn'
        : `${match.seats[match.turn].name}'s turn`;
    this.announce(line);
  }

  showVerdict(word: string, line: string): void {
    const verdict = this.dom.verdict;
    if (this.verdictTimer !== null) window.clearTimeout(this.verdictTimer);
    if (this.verdictLeave !== null) window.clearTimeout(this.verdictLeave);
    verdict.classList.remove('leaving');
    this.dom.verdictWord.textContent = word;
    this.dom.verdictLine.textContent = line;
    verdict.classList.remove('shown');
    void verdict.getBoundingClientRect();
    verdict.classList.add('shown');
    this.verdictTimer = window.setTimeout(() => {
      verdict.classList.add('leaving');
      this.verdictLeave = window.setTimeout(() => {
        verdict.classList.remove('shown', 'leaving');
      }, 150);
    }, state.config.verdictBannerMs);
  }

  announce(line: string): void {
    this.dom.announcer.append(el('p', { text: line }));
  }

  /* Dialogs */

  private openBoardOver(match: MatchJson, winnerSeat: Seat, board: number, pointsLine: string): void {
    this.dom.root.dataset.phase = 'board-over';
    openDialog('Board over', (handle) => {
      const next = el('button', { type: 'button', text: 'Next board' });
      next.addEventListener('click', () => {
        handle.close();
        const pending = this.pendingMatch;
        this.pendingMatch = null;
        if (pending !== null) this.setState(pending, true);
        this.dom.board.focus();
      });
      window.requestAnimationFrame(() => next.focus());
      return [
        el('h2', { class: 'display', text: `${match.seats[winnerSeat].name} wins board ${board}`, style: 'font-size: var(--step-2)' }),
        el('p', { id: 'board-points', text: pointsLine }),
        el('div', { class: 'dialog-actions' }, [next]),
      ];
    });
  }

  openMatchOver(match: MatchJson, pointsLine: string | null): void {
    if (this.matchOverShown) return;
    this.matchOverShown = true;
    const mySeat = this.hooks.mySeat;
    const won = match.winnerSeat !== null && match.winnerSeat === mySeat;
    const heading = this.hooks.local
      ? `${match.seats[match.winnerSeat ?? 0].name} wins`
      : won
        ? 'You won'
        : 'You lost';
    const mine = this.hooks.local ? 0 : (mySeat ?? 0);
    const theirs = otherSeat(mine as Seat);
    const body: (Node | string)[] = [
      el('h2', { class: 'display', text: heading, style: 'font-size: var(--step-3)' }),
      el('p', { id: 'final-score', class: 'num', text: `Final score ${match.seats[mine].score}-${match.seats[theirs].score}` }),
    ];
    if (pointsLine !== null) body.push(el('p', { id: 'board-points', text: pointsLine }));
    if (match.endReason !== null && match.endReason !== 'played') {
      const loser = match.winnerSeat === null ? 0 : otherSeat(match.winnerSeat);
      const name = match.seats[loser].name;
      const reason =
        match.endReason === 'left'
          ? `${name} forfeited: left the match`
          : match.endReason === 'timeouts'
            ? `${name} forfeited: 3 timeouts in a row`
            : `${name} resigned`;
      body.push(el('p', { id: 'end-reason', text: reason }));
    }
    if (match.mode === 'ranked') {
      const change = match.ratingChange[mine];
      if (change !== null && change !== undefined) {
        const delta = Math.round(change.delta);
        body.push(
          el('p', {
            id: 'rating-change',
            class: 'num',
            text: `Rating ${Math.round(change.rating)} (${delta >= 0 ? '+' : ''}${delta})`,
          }),
        );
      }
    }
    body.push(el('p', { id: 'chalk-earned', class: 'num', text: `+${match.chalkEarned[mine] ?? 0} chalk` }));

    const announceLine = `${heading}. Final score ${match.seats[mine].score}-${match.seats[theirs].score}.`;
    openDialog(
      'Match over',
      () => {
        const actions: (Node | string)[] = [];
        if (this.hooks.local) {
          body.push(el('p', { id: 'save-status', text: 'Saving...' }));
        }
        if (this.hooks.privateRoom && this.hooks.rematch !== undefined) {
          const rematch = el('button', { type: 'button', text: 'Rematch' });
          rematch.addEventListener('click', () => {
            rematch.textContent = 'Rematch offered';
            this.hooks.rematch?.(true);
          });
          actions.push(rematch);
        }
        actions.push(el('a', { href: '/', class: 'hero__cta', text: 'Home' }));
        return [...body, el('div', { class: 'dialog-actions', id: 'match-over-actions' }, actions)];
      },
      { escapes: false },
    );
    this.announce(announceLine);
    const dialog = document.querySelector<HTMLElement>('dialog[aria-label="Match over"]');
    if (dialog !== null) this.hooks.onMatchOver?.(dialog);
  }

  showRematchOffer(name: string): void {
    const actions = document.getElementById('match-over-actions');
    if (actions === null) return;
    if (actions.querySelector('[data-accept-rematch]') !== null) return;
    const accept = el('button', { type: 'button', text: 'Accept rematch', 'data-accept-rematch': 'true' });
    accept.addEventListener('click', () => this.hooks.rematch?.(true));
    actions.prepend(el('p', { text: `${name} wants a rematch.` }), accept);
    this.announce(`${name} wants a rematch.`);
  }

  private openMenu(): void {
    openDialog('Menu', (handle) => {
      const rules = el('button', { type: 'button', text: 'Rules' });
      const resign = el('button', { type: 'button', text: 'Resign' });
      const close = el('button', { type: 'button', text: 'Close' });
      rules.addEventListener('click', () => this.openRules());
      resign.addEventListener('click', () => {
        handle.close();
        this.openResign();
      });
      close.addEventListener('click', () => handle.close());
      window.requestAnimationFrame(() => rules.focus());
      return [
        el('h2', { class: 'display', text: 'Menu', style: 'font-size: var(--step-2)' }),
        el('div', { class: 'menu-list' }, [rules, resign, close]),
      ];
    });
  }

  private openRules(): void {
    openDialog('Rules', (handle) => {
      const close = el('button', { type: 'button', text: 'Close' });
      close.addEventListener('click', () => handle.close());
      window.requestAnimationFrame(() => close.focus());
      return [
        el('h2', { class: 'display', text: 'Rules', style: 'font-size: var(--step-2)' }),
        el('ul', {}, RULES_SUMMARY.map((line) => el('li', { text: line }))),
        el('div', { class: 'dialog-actions' }, [close]),
      ];
    });
  }

  private openResign(): void {
    openDialog('Resign this match?', (handle) => {
      const confirm = el('button', { type: 'button', text: 'Resign' });
      const keep = el('button', { type: 'button', text: 'Keep playing' });
      confirm.addEventListener('click', () => {
        handle.close();
        this.hooks.resign();
      });
      keep.addEventListener('click', () => {
        handle.close();
        this.dom.menu.focus();
      });
      window.requestAnimationFrame(() => confirm.focus());
      handle.dialog.addEventListener('close', () => this.dom.menu.focus());
      return [
        el('h2', { class: 'display', text: 'Resign this match?', style: 'font-size: var(--step-2)' }),
        el('div', { class: 'dialog-actions' }, [confirm, keep]),
      ];
    });
  }

  private openEmotes(): void {
    const existing = document.getElementById('emote-menu');
    if (existing !== null) {
      existing.remove();
      return;
    }
    const menu = el('div', { role: 'menu', id: 'emote-menu', class: 'surface', style: 'position:absolute;z-index:45' });
    for (const entry of EMOTE_LABELS) {
      const item = el('button', { type: 'button', role: 'menuitem', text: entry.label });
      item.addEventListener('click', () => {
        this.hooks.emote?.(entry.emote);
        menu.remove();
        this.dom.emotes.focus();
      });
      menu.append(item);
    }
    trapFocus(menu);
    this.dom.root.append(menu);
    (menu.firstElementChild as HTMLElement | null)?.focus();
  }

  showEmote(name: string, emote: string): void {
    const label = EMOTE_LABELS.find((entry) => entry.emote === emote)?.label ?? emote;
    this.dom.emoteBubble.textContent = label;
    this.announce(`${name}: ${label}`);
    if (this.emoteTimer !== null) window.clearTimeout(this.emoteTimer);
    this.emoteTimer = window.setTimeout(() => {
      this.dom.emoteBubble.textContent = '';
    }, 3000);
  }

  /* Shot clock */

  private startClock(): void {
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    if (this.hooks.local) return;
    let remaining = this.match.turnRemainingMs;
    if (remaining === null) {
      this.dom.shotTimer.textContent = mmss(state.config.shotTimerSeconds * 1000);
      return;
    }
    const paint = (): void => {
      this.dom.shotTimer.textContent = mmss(remaining ?? 0);
      this.dom.shotTimer.classList.toggle('urgent', (remaining ?? 0) <= 5000);
    };
    paint();
    this.clockTimer = window.setInterval(() => {
      remaining = Math.max(0, (remaining ?? 0) - 250);
      paint();
    }, 250);
  }

  /* Reconnect */

  /** The overlay follows the opponent's seat in whatever state the server last sent. */
  private syncReconnect(): void {
    if (this.hooks.local || this.hooks.mySeat === null) return;
    const opponent = this.match.seats[otherSeat(this.hooks.mySeat)];
    if (this.match.status !== 'active' || opponent.connected) {
      if (this.announcedReconnect !== '') this.showReconnecting(opponent.name, null);
      return;
    }
    if (this.announcedReconnect === opponent.name) return;
    this.showReconnecting(opponent.name, opponent.reconnectRemainingMs ?? 0);
  }

  showReconnecting(name: string, remainingMs: number | null): void {
    if (remainingMs === null) {
      this.dom.reconnectOverlay.hidden = true;
      this.dom.reconnectOverlay.textContent = '';
      this.announcedReconnect = '';
      if (this.reconnectTimer !== null) window.clearInterval(this.reconnectTimer);
      return;
    }
    let remaining = remainingMs;
    const paint = (): void => {
      this.dom.reconnectOverlay.textContent = `${name} is reconnecting... ${mmss(remaining)}`;
    };
    this.dom.reconnectOverlay.hidden = false;
    paint();
    if (this.announcedReconnect !== name) {
      this.announcedReconnect = name;
      this.announce(this.dom.reconnectOverlay.textContent ?? '');
    }
    if (this.reconnectTimer !== null) window.clearInterval(this.reconnectTimer);
    this.reconnectTimer = window.setInterval(() => {
      remaining = Math.max(0, remaining - 500);
      paint();
    }, 500);
  }

  showGhost(x: number, dx: number, dy: number, seat: Seat): void {
    const boardX = offsetToBoardX(x, seat);
    const boardY = baselineY(seat);
    this.dom.handles.ghostStriker.setAttribute('transform', `translate(${boardX} ${boardY})`);
    this.dom.handles.ghostStriker.dataset.x = oneDecimal(boardX);
    this.dom.handles.ghostStriker.dataset.y = oneDecimal(boardY);
    this.dom.handles.ghostStriker.setAttribute('opacity', '0.4');
    const line = this.dom.handles.ghostAim.firstElementChild;
    if (line !== null) {
      line.setAttribute('x1', String(boardX));
      line.setAttribute('y1', String(boardY));
      line.setAttribute('x2', String(boardX + dx * 220));
      line.setAttribute('y2', String(boardY + dy * 220));
    }
    this.dom.handles.ghostAim.setAttribute('opacity', '0.4');
  }

  hideGhost(): void {
    this.dom.handles.ghostStriker.setAttribute('opacity', '0');
    this.dom.handles.ghostAim.setAttribute('opacity', '0');
  }

  phase(): string {
    return this.dom.root.dataset.phase ?? 'aim';
  }

  focusBoard(): void {
    this.dom.board.focus();
  }

  setSaveStatus(text: string): void {
    const node = document.getElementById('save-status');
    if (node !== null) node.textContent = text;
  }

  setChalkEarned(chalk: number): void {
    const node = document.getElementById('chalk-earned');
    if (node !== null) node.textContent = `+${chalk} chalk`;
  }
}
