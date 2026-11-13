import { HOLD_CANCEL, LOUPE_LABELS, NO_POWER_CANCEL, SPIN_TEXT, loupeNumeral, num } from '../shared/copy.js';
import { predictFirstBall } from '../shared/table-geometry.js';
import { POCKETS, POCKET_LABELS, type Pocket, type Point, type ShotInput } from '../shared/types.js';
import { appendLogLines, attachDialogKeys, clear, dialogIsOpen, el, labelledButton, sliderInput, statusRegion } from './dom.js';
import { canvasToPoint, drawLoupe, drawTable, type Orientation, type Scene } from './table-canvas.js';

export interface TableSeatModel {
  name: string;
  groupLabel: string;
  ballsLeftText: string;
  connected: boolean;
}

export interface TableResultModel {
  line: string;
  coinChange: string;
  xpGained: string;
  levelUpLines: string[];
  rematchDisabledReason: string | null;
  showRematch: boolean;
  rematchWaiting: string | null;
}

export interface TableModel {
  seats: [TableSeatModel, TableSeatModel];
  potText: string;
  ruleBanner: string;
  turn: string;
  announcements: string[];
  shotClockSeconds: number | null;
  reconnectText: string | null;
  myTurn: boolean;
  ballInHand: boolean;
  behindHeadString: boolean;
  calledPocketRequired: boolean;
  positions: { ball: number; across: number; along: number }[];
  balls: number[];
  receipt: string;
  tutorialStep: number | null;
  loupeEnabled: boolean;
  myGroupLabel: string | null;
  cloth: string;
  guidelineLength: number;
  result: TableResultModel | null;
  invite: { url: string; waitingText: string } | null;
}

export interface TableHandlers {
  onShot: (shot: ShotInput) => void;
  onPlace: (across: number, along: number) => void;
  onRematch: () => void;
  onCancelLine: (line: string) => void;
  onBackToLobby: () => void;
}

const SPIN_CYCLE = ['none', 'top', 'back', 'left', 'right'] as const;

export class TableView {
  readonly element: HTMLElement;
  private model: TableModel | null = null;
  private readonly handlers: TableHandlers;

  private aim = 0;
  private fine = 0;
  private power = 50;
  private sideSpin = 0;
  private topSpin = 0;
  private spinIndex = 0;
  private locked = false;
  private calledPocket: Pocket | null = null;
  private placement: Point = { across: 50, along: 25 };
  private tangentProgress = 0;
  private tangentTarget = 0;
  private loupeOpen = false;
  private holdStart: number | null = null;
  private holdTimer: number | null = null;
  private frame: number | null = null;
  private lastTurnKey = '';
  private lastCanvasWidth = 0;
  private observer: ResizeObserver | null = null;
  private serverLineCount = 0;
  private logLines: string[] = [];
  private resultShown = false;
  private resultWaiting: HTMLElement | null = null;
  private bannerOverride: string | null = null;

  private readonly canvas = el('canvas', { className: 'table-canvas', attrs: { role: 'img', 'aria-label': 'Table' } });
  private readonly loupeCanvas = el('canvas', { className: 'loupe-canvas', attrs: { role: 'img', 'aria-label': 'Contact loupe view' } });
  private readonly loupeStatus = statusRegion('Contact loupe', 'loupe-status');
  private readonly tangentBar = el('div', {
    className: 'tangent-bar',
    attrs: { role: 'progressbar', 'aria-label': 'Tangent draw', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
  });
  private readonly turnStatus = statusRegion('Turn', 'turn-status');
  private readonly spinStatus = statusRegion('Spin', 'spin-status');
  private readonly bannerStatus = statusRegion('Rule banner', 'rule-banner');
  private readonly tutorialStatus = statusRegion('Tutorial step', 'tutorial-step');
  private readonly receiptRegion = el('div', { className: 'receipt', attrs: { role: 'region', 'aria-label': 'Shot receipt' } });
  private readonly log = el('div', { className: 'table-log', attrs: { role: 'log', 'aria-label': 'Table announcements', 'aria-live': 'polite' } });
  private readonly shotClock = el('p', { className: 'timer', attrs: { role: 'timer', 'aria-label': 'Shot clock' } });
  private readonly reconnectTimer = el('p', { className: 'timer', attrs: { role: 'timer', 'aria-label': 'Reconnect' } });
  private readonly scoreboard = el('div', { className: 'scoreboard', attrs: { role: 'region', 'aria-label': 'Scoreboard' } });
  private readonly seatLines = [el('p', { className: 'seat-line' }), el('p', { className: 'seat-line' })];
  private readonly potLine = el('p', { className: 'pot-line' });
  private readonly controls = el('div', { className: 'shot-controls', attrs: { role: 'region', 'aria-label': 'Shot controls' } });
  private readonly pocketGroup = el('div', { className: 'pocket-group', attrs: { role: 'radiogroup', 'aria-label': 'Called pocket' } });
  private readonly placementGroup = el('div', { className: 'placement-group', attrs: { role: 'group', 'aria-label': 'Ball placement' } });
  private readonly loupeWrap = el('div', { className: 'loupe' });
  private readonly inviteRow = el('div', { className: 'invite-row' });
  private readonly resultHost = el('div', { className: 'result-host' });

  private readonly aimSlider: HTMLInputElement;
  private readonly fineSlider: HTMLInputElement;
  private readonly powerSlider: HTMLInputElement;
  private readonly sideSlider: HTMLInputElement;
  private readonly topSlider: HTMLInputElement;
  private readonly lockButton: HTMLButtonElement;
  private readonly strikeButton: HTMLButtonElement;
  private readonly placeAcross: HTMLInputElement;
  private readonly placeAlong: HTMLInputElement;

  constructor(handlers: TableHandlers) {
    this.handlers = handlers;

    this.aimSlider = sliderInput({ name: 'Aim angle', min: 0, max: 359.9, step: 0.1, value: 0, onInput: (value) => this.setAim(value, true) });
    this.fineSlider = sliderInput({
      name: 'Fine aim',
      min: -1,
      max: 1,
      step: 0.1,
      value: 0,
      onInput: (value) => {
        if (this.locked) {
          this.fineSlider.value = String(this.fine);
          return;
        }
        this.fine = value;
        this.refreshAim();
      },
    });
    this.powerSlider = sliderInput({
      name: 'Shot power',
      min: 0,
      max: 100,
      step: 1,
      value: 50,
      onInput: (value) => {
        this.power = value;
      },
    });
    this.sideSlider = sliderInput({
      name: 'Side spin',
      min: -100,
      max: 100,
      step: 1,
      value: 0,
      onInput: (value) => {
        this.sideSpin = value;
        this.updateSpinText();
      },
    });
    this.topSlider = sliderInput({
      name: 'Top spin',
      min: -100,
      max: 100,
      step: 1,
      value: 0,
      onInput: (value) => {
        this.topSpin = value;
        this.updateSpinText();
      },
    });
    this.lockButton = labelledButton('Lock aim', () => this.toggleLock(), { className: 'button lock', attrs: { 'aria-pressed': 'false' } });
    this.strikeButton = labelledButton('Strike', () => this.strike(), { className: 'button strike' });
    this.placeAcross = sliderInput({
      name: 'Cue ball across',
      min: 0,
      max: 100,
      step: 1,
      value: 50,
      onInput: (value) => {
        this.placement.across = value;
        this.render();
      },
    });
    this.placeAlong = sliderInput({
      name: 'Cue ball along',
      min: 0,
      max: 100,
      step: 1,
      value: 25,
      onInput: (value) => {
        this.placement.along = this.clampAlong(value);
        this.placeAlong.value = String(this.placement.along);
        this.render();
      },
    });

    this.loupeWrap.append(this.loupeCanvas);
    this.scoreboard.append(
      el('h2', { className: 'scoreboard-title', text: 'Scoreboard' }),
      this.seatLines[0] as HTMLElement,
      this.seatLines[1] as HTMLElement,
      this.potLine,
      this.bannerStatus,
      this.shotClock,
      this.reconnectTimer,
    );

    this.placementGroup.append(
      el('span', { className: 'control-label', text: 'Cue ball across' }),
      this.placeAcross,
      el('span', { className: 'control-label', text: 'Cue ball along' }),
      this.placeAlong,
      labelledButton('Place ball', () => this.placeBall(), { className: 'button' }),
    );

    this.controls.append(
      el('div', {
        className: 'slider-row',
        children: [el('span', { className: 'control-label', text: 'Aim angle' }), this.aimSlider],
      }),
      el('div', { className: 'slider-row', children: [el('span', { className: 'control-label', text: 'Fine aim' }), this.fineSlider] }),
      el('div', { className: 'slider-row', children: [el('span', { className: 'control-label', text: 'Shot power' }), this.powerSlider] }),
      el('div', { className: 'slider-row', children: [el('span', { className: 'control-label', text: 'Side spin' }), this.sideSlider] }),
      el('div', { className: 'slider-row', children: [el('span', { className: 'control-label', text: 'Top spin' }), this.topSlider] }),
      el('div', { className: 'button-row', children: [this.lockButton, this.strikeButton] }),
    );

    for (const pocket of POCKETS) {
      const input = el('input', { attrs: { type: 'radio', name: 'called-pocket', value: pocket } });
      input.addEventListener('change', () => {
        this.calledPocket = pocket;
        this.updateStrikeState();
      });
      this.pocketGroup.append(el('label', { className: 'pocket-option', children: [input, POCKET_LABELS[pocket]] }));
    }

    const backLink = el('a', { className: 'back-link', text: 'Back to lobby', attrs: { href: '/home' } });
    backLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.handlers.onBackToLobby();
    });

    this.element = el('div', {
      className: 'table-screen',
      children: [
        this.scoreboard,
        el('div', {
          className: 'table-area',
          children: [
            this.canvas,
            this.loupeWrap,
            el('div', {
              className: 'table-readouts',
              children: [this.turnStatus, this.spinStatus, this.loupeStatus, this.tangentBar, this.receiptRegion, this.tutorialStatus],
            }),
          ],
        }),
        el('div', {
          className: 'controls-area',
          children: [this.pocketGroup, this.placementGroup, this.controls, this.inviteRow, backLink],
        }),
        this.log,
        this.resultHost,
      ],
    });

    this.canvas.addEventListener('pointermove', (event) => this.pointerAim(event as PointerEvent, false));
    this.canvas.addEventListener('pointerdown', (event) => this.pointerAim(event as PointerEvent, true));
    document.addEventListener('keydown', this.keydown, true);
    document.addEventListener('keyup', this.keyup, true);
    window.addEventListener('resize', this.resize);
    this.observer = new ResizeObserver(() => {
      const area = this.canvas.parentElement;
      const width = area ? area.clientWidth : 0;
      if (width > 0 && Math.abs(width - this.lastCanvasWidth) > 1) this.render();
    });
    this.observer.observe(this.element);
    this.loop();
  }

  destroy(): void {
    document.removeEventListener('keydown', this.keydown, true);
    document.removeEventListener('keyup', this.keyup, true);
    window.removeEventListener('resize', this.resize);
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.holdTimer !== null) window.clearInterval(this.holdTimer);
  }

  setModel(model: TableModel): void {
    const previous = this.model;
    this.model = model;
    const turnKey = `${model.myTurn}:${model.ballInHand}:${model.turn}`;
    if (turnKey !== this.lastTurnKey) {
      this.lastTurnKey = turnKey;
      if (model.myTurn) {
        this.power = 50;
        this.powerSlider.value = '50';
        this.calledPocket = null;
        for (const input of this.pocketGroup.querySelectorAll('input')) input.checked = false;
      }
    }
    if (model.ballInHand && model.myTurn && (!previous || !previous.ballInHand)) {
      this.placement = { across: 50, along: 25 };
      this.placeAcross.value = '50';
      this.placeAlong.value = '25';
    }
    if (model.announcements.length !== this.serverLineCount) this.bannerOverride = null;
    this.appendServerLines(model.announcements);
    this.render();
  }

  private appendServerLines(lines: string[]): void {
    if (lines.length < this.serverLineCount) {
      this.serverLineCount = 0;
      this.logLines = [];
    }
    for (let index = this.serverLineCount; index < lines.length; index += 1) {
      this.logLines.push(lines[index] as string);
    }
    this.serverLineCount = lines.length;
  }

  setBanner(text: string): void {
    this.bannerOverride = text;
    this.bannerStatus.textContent = text;
  }

  addLocalLine(line: string): void {
    this.logLines.push(line);
    appendLogLines(this.log, this.logLines);
  }

  private clampAlong(value: number): number {
    const model = this.model;
    if (model?.behindHeadString) return Math.min(25, value);
    return value;
  }

  private setAim(value: number, fromSlider: boolean): void {
    if (this.locked) {
      this.aimSlider.value = String(this.aim);
      return;
    }
    const wrapped = ((value % 360) + 360) % 360;
    this.aim = Math.round(wrapped * 10) / 10;
    if (!fromSlider) this.aimSlider.value = String(this.aim);
    this.openLoupe();
    this.render();
  }

  private refreshAim(): void {
    this.openLoupe();
    this.render();
  }

  private effectiveAim(): number {
    const combined = this.aim + this.fine;
    return Math.round(((combined % 360) + 360) % 360 * 10) / 10;
  }

  private openLoupe(): void {
    const model = this.model;
    if (!model || !model.loupeEnabled || !model.myTurn) return;
    if (!this.loupeOpen) {
      this.loupeOpen = true;
      this.loupeWrap.classList.add('open');
    }
  }

  private toggleLock(): void {
    this.locked = !this.locked;
    this.lockButton.setAttribute('aria-pressed', this.locked ? 'true' : 'false');
    this.tangentTarget = this.locked ? 1 : 0;
    if (this.locked) this.openLoupe();
    if (document.documentElement.classList.contains('reduced-motion')) {
      this.tangentProgress = this.tangentTarget;
    }
    this.render();
  }

  private cycleSpin(): void {
    this.spinIndex = (this.spinIndex + 1) % SPIN_CYCLE.length;
    const mode = SPIN_CYCLE[this.spinIndex] ?? 'none';
    const values: Record<string, [number, number]> = {
      none: [0, 0],
      top: [0, 50],
      back: [0, -50],
      left: [-50, 0],
      right: [50, 0],
    };
    const pair = values[mode] ?? [0, 0];
    this.sideSpin = pair[0] as number;
    this.topSpin = pair[1] as number;
    this.sideSlider.value = String(this.sideSpin);
    this.topSlider.value = String(this.topSpin);
    this.spinStatus.textContent = SPIN_TEXT[mode];
  }

  private updateSpinText(): void {
    if (this.sideSpin === 0 && this.topSpin === 0) this.spinStatus.textContent = SPIN_TEXT.none;
    else if (Math.abs(this.topSpin) >= Math.abs(this.sideSpin)) this.spinStatus.textContent = this.topSpin > 0 ? SPIN_TEXT.top : SPIN_TEXT.back;
    else this.spinStatus.textContent = this.sideSpin > 0 ? SPIN_TEXT.right : SPIN_TEXT.left;
  }

  private canAct(): boolean {
    return Boolean(this.model?.myTurn) && !this.model?.result;
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (!document.contains(this.element)) return;
    if (dialogIsOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text')) return;
    if (target && target.tagName === 'TEXTAREA') return;
    if (!this.canAct()) return;
    const insidePockets = target ? this.pocketGroup.contains(target) : false;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (insidePockets) return;
      event.preventDefault();
      if (this.locked) return;
      const step = event.shiftKey ? 0.1 : 1;
      this.setAim(this.aim + (event.key === 'ArrowRight' ? step : -step), false);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (insidePockets) return;
      if (target === this.aimSlider || !(target instanceof HTMLInputElement) || target.type !== 'range') {
        event.preventDefault();
      }
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      this.cycleSpin();
      return;
    }
    if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      this.toggleLock();
      return;
    }
    if (event.key === 'Escape' && this.holdStart !== null) {
      event.preventDefault();
      this.cancelHold(HOLD_CANCEL);
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (this.model?.calledPocketRequired && !this.calledPocket) {
        this.handlers.onCancelLine('Call a pocket before you shoot.');
        return;
      }
      if (this.holdStart === null) this.startHold();
    }
  };

  private readonly keyup = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.code === 'Space') {
      if (this.holdStart === null) return;
      event.preventDefault();
      this.releaseHold();
    }
  };

  private startHold(): void {
    this.holdStart = performance.now();
    this.power = 0;
    this.powerSlider.value = '0';
    this.holdTimer = window.setInterval(() => {
      if (this.holdStart === null) return;
      const elapsed = (performance.now() - this.holdStart) / 1000;
      const value = elapsed <= 0.2 ? 0 : Math.min(100, (elapsed - 0.2) * 50);
      this.power = Math.round(value);
      this.powerSlider.value = String(this.power);
    }, 16);
  }

  private stopHold(): void {
    this.holdStart = null;
    if (this.holdTimer !== null) {
      window.clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private cancelHold(line: string): void {
    this.stopHold();
    this.power = 50;
    this.powerSlider.value = '50';
    this.handlers.onCancelLine(line);
  }

  private releaseHold(): void {
    const power = this.power;
    this.stopHold();
    if (power <= 0) {
      this.power = 50;
      this.powerSlider.value = '50';
      this.handlers.onCancelLine(NO_POWER_CANCEL);
      return;
    }
    this.fire(power);
  }

  private strike(): void {
    if (!this.canAct()) return;
    if (this.model?.calledPocketRequired && !this.calledPocket) {
      this.handlers.onCancelLine('Call a pocket before you shoot.');
      return;
    }
    if (this.power <= 0) {
      this.power = 50;
      this.powerSlider.value = '50';
      this.handlers.onCancelLine(NO_POWER_CANCEL);
      return;
    }
    this.fire(this.power);
  }

  private fire(power: number): void {
    this.handlers.onShot({
      aimDegrees: this.effectiveAim(),
      power,
      sideSpin: this.sideSpin,
      topSpin: this.topSpin,
      calledPocket: this.calledPocket,
    });
    this.power = 50;
    this.powerSlider.value = '50';
    if (this.locked) this.toggleLock();
  }

  private placeBall(): void {
    this.handlers.onPlace(this.placement.across, this.placement.along);
  }

  private pointerAim(event: PointerEvent, pressed: boolean): void {
    const model = this.model;
    if (!model || !this.canAct() || this.locked) return;
    const rect = this.canvas.getBoundingClientRect();
    const orientation = this.orientation();
    const point = canvasToPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, orientation);
    if (model.ballInHand && pressed) {
      this.placement = { across: Math.max(0, Math.min(100, point.across)), along: this.clampAlong(Math.max(0, Math.min(100, point.along))) };
      this.placeAcross.value = String(Math.round(this.placement.across));
      this.placeAlong.value = String(Math.round(this.placement.along));
      this.render();
      return;
    }
    const cue = this.cueBall();
    const dx = point.across - cue.across;
    const dy = (point.along - cue.along) * 2;
    if (Math.hypot(dx, dy) < 1) return;
    const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
    this.setAim(degrees, false);
  }

  private cueBall(): Point {
    const model = this.model;
    if (model?.ballInHand && model.myTurn) return this.placement;
    const found = model?.positions.find((entry) => entry.ball === 0);
    return found ? { across: found.across, along: found.along } : { across: 50, along: 25 };
  }

  private orientation(): Orientation {
    return window.innerWidth < 768 ? 'vertical' : 'horizontal';
  }

  private readonly resize = (): void => this.render();

  private loop(): void {
    const step = (): void => {
      const reduced = document.documentElement.classList.contains('reduced-motion');
      if (this.tangentProgress !== this.tangentTarget) {
        if (reduced) this.tangentProgress = this.tangentTarget;
        else {
          const delta = (1 / 0.33) * (1 / 60);
          this.tangentProgress =
            this.tangentTarget > this.tangentProgress
              ? Math.min(this.tangentTarget, this.tangentProgress + delta)
              : Math.max(this.tangentTarget, this.tangentProgress - delta);
        }
        this.render();
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private updateStrikeState(): void {
    const model = this.model;
    const blocked = Boolean(model?.calledPocketRequired) && !this.calledPocket;
    this.strikeButton.disabled = blocked || !model?.myTurn;
  }

  private render(): void {
    const model = this.model;
    if (!model) return;

    const seatOne = model.seats[0];
    const seatTwo = model.seats[1];
    (this.seatLines[0] as HTMLElement).textContent = `${seatOne.name} ${seatOne.groupLabel} ${seatOne.ballsLeftText}`;
    (this.seatLines[1] as HTMLElement).textContent = `${seatTwo.name} ${seatTwo.groupLabel} ${seatTwo.ballsLeftText}`;
    this.potLine.textContent = model.potText;
    this.bannerStatus.textContent = this.bannerOverride ?? model.ruleBanner;
    this.turnStatus.textContent = model.turn;
    this.receiptRegion.textContent = model.receipt;
    this.tutorialStatus.textContent = model.tutorialStep === null ? '' : `Step ${model.tutorialStep} of 3`;
    this.tutorialStatus.hidden = model.tutorialStep === null;
    if (!this.spinStatus.textContent) this.spinStatus.textContent = SPIN_TEXT.none;

    if (model.shotClockSeconds === null) {
      this.shotClock.hidden = true;
      this.shotClock.textContent = '';
    } else {
      this.shotClock.hidden = false;
      this.shotClock.textContent = `${num(model.shotClockSeconds)}s`;
    }
    if (model.reconnectText === null) {
      this.reconnectTimer.hidden = true;
      this.reconnectTimer.textContent = '';
    } else {
      this.reconnectTimer.hidden = false;
      this.reconnectTimer.textContent = model.reconnectText;
    }

    const showControls = model.myTurn && !model.result;
    this.controls.hidden = !showControls;
    if (showControls) this.controls.removeAttribute('inert');
    else this.controls.setAttribute('inert', '');
    this.pocketGroup.hidden = !(showControls && model.calledPocketRequired);
    this.placementGroup.hidden = !(showControls && model.ballInHand);
    if (this.placementGroup.hidden) this.placementGroup.setAttribute('inert', '');
    else this.placementGroup.removeAttribute('inert');
    if (this.pocketGroup.hidden) this.pocketGroup.setAttribute('inert', '');
    else this.pocketGroup.removeAttribute('inert');
    this.updateStrikeState();

    appendLogLines(this.log, this.logLines);

    const positions = model.positions.map((entry) => ({ ...entry }));
    if (model.ballInHand && model.myTurn) {
      const cue = positions.find((entry) => entry.ball === 0);
      if (cue) {
        cue.across = this.placement.across;
        cue.along = this.placement.along;
      } else positions.push({ ball: 0, across: this.placement.across, along: this.placement.along });
    }

    const cue = this.cueBall();
    const prediction = model.loupeEnabled
      ? predictFirstBall(
          cue,
          this.effectiveAim(),
          Object.fromEntries(positions.filter((entry) => entry.ball !== 0).map((entry) => [entry.ball, { across: entry.across, along: entry.along }])),
          model.balls,
        )
      : { ball: null, cutAngle: null, blocked: true, contact: null, tangent: null };

    const scene: Scene = {
      positions,
      aimDegrees: this.effectiveAim(),
      guideline: model.loupeEnabled && model.myTurn,
      guidelineLength: model.guidelineLength,
      contact: this.loupeOpen && prediction.contact ? prediction.contact : null,
      tangent: prediction.tangent,
      tangentProgress: this.tangentProgress,
      cloth: model.cloth,
      locked: this.locked,
    };

    const orientation = this.orientation();
    const area = this.canvas.parentElement;
    const availableWidth = area ? area.clientWidth || 320 : 320;
    this.lastCanvasWidth = availableWidth;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = orientation === 'vertical' ? Math.min(availableWidth, 360) : Math.min(availableWidth, 720);
    const cssHeight = orientation === 'vertical' ? cssWidth * 2 : cssWidth / 2;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * ratio);
    this.canvas.height = Math.round(cssHeight * ratio);
    const context = this.canvas.getContext('2d');
    if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawTable(context, scene, cssWidth, cssHeight, orientation);
    }

    const showLoupe = this.loupeOpen && model.loupeEnabled && model.myTurn;
    this.loupeWrap.hidden = !showLoupe;
    this.loupeWrap.classList.toggle('locked', this.locked);
    if (showLoupe) {
      const size = 120;
      this.loupeCanvas.style.width = `${size}px`;
      this.loupeCanvas.style.height = `${size}px`;
      this.loupeCanvas.width = Math.round(size * ratio);
      this.loupeCanvas.height = Math.round(size * ratio);
      const loupeContext = this.loupeCanvas.getContext('2d');
      if (loupeContext) {
        loupeContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawLoupe(loupeContext, scene, size, orientation);
      }
      const label = prediction.blocked
        ? LOUPE_LABELS.blocked
        : this.legalFirstBall(prediction.ball, model)
          ? LOUPE_LABELS.legal
          : LOUPE_LABELS.wrong;
      const parts = [label, loupeNumeral(prediction.blocked ? null : prediction.cutAngle)];
      if (prediction.ball !== null) parts.push(`First ball ${prediction.ball}`);
      this.loupeStatus.textContent = parts.join(' ');
      this.tangentBar.hidden = false;
      this.tangentBar.setAttribute('aria-valuenow', String(Math.round(this.tangentProgress * 100)));
      this.tangentBar.style.setProperty('--draw', String(this.tangentProgress));
    } else {
      this.loupeStatus.textContent = '';
      this.tangentBar.hidden = true;
    }

    clear(this.inviteRow);
    if (model.invite) {
      const field = el('input', { className: 'invite-link', attrs: { type: 'text', readonly: true, 'aria-label': 'Invite link' } });
      field.value = model.invite.url;
      this.inviteRow.append(
        el('p', { className: 'notice', text: model.invite.waitingText }),
        field,
        labelledButton('Copy link', () => void navigator.clipboard?.writeText(model.invite?.url ?? ''), { className: 'button' }),
      );
    }

    if (model.result && !this.resultShown) {
      this.resultShown = true;
      this.showResult(model.result);
    } else if (model.result && this.resultWaiting) {
      this.resultWaiting.textContent = model.result.rematchWaiting ?? '';
    }
    if (!model.result) {
      this.resultShown = false;
      this.resultWaiting = null;
    }
  }

  private legalFirstBall(ball: number | null, model: TableModel): boolean {
    if (ball === null) return false;
    const myGroup = model.myGroupLabel;
    if (!myGroup || myGroup === 'Open') return ball !== 8 || model.calledPocketRequired;
    if (model.calledPocketRequired) return ball === 8;
    if (myGroup === 'Solids') return ball >= 1 && ball <= 7;
    return ball >= 9 && ball <= 15;
  }

  private showResult(result: TableResultModel): void {
    clear(this.resultHost);
    const reduced = document.documentElement.classList.contains('reduced-motion');
    const coinStatus = statusRegion('Coin change', 'result-line');
    const xpStatus = statusRegion('XP gained', 'result-line');
    const waiting = el('p', { className: 'notice', text: result.rematchWaiting ?? '' });
    this.resultWaiting = waiting;
    const rematch = labelledButton('Rematch', () => this.handlers.onRematch(), { className: 'button' });
    if (result.rematchDisabledReason) rematch.disabled = true;
    const back = labelledButton('Back to lobby', () => this.handlers.onBackToLobby(), { className: 'button' });
    const dialog = el('div', {
      className: 'dialog result-dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Match result' },
      children: [
        el('h2', { className: 'result-heading', text: result.line }),
        coinStatus,
        xpStatus,
        ...result.levelUpLines.map((line) => el('p', { className: 'notice', text: line })),
        result.rematchDisabledReason ? el('p', { className: 'notice', text: result.rematchDisabledReason }) : null,
        waiting,
        el('div', { className: 'button-row', children: [rematch, back] }),
      ],
    });
    const backdrop = el('div', { className: 'backdrop', children: [dialog] });
    this.resultHost.append(backdrop);
    attachDialogKeys(dialog, {});
    countUp(coinStatus, result.coinChange, reduced);
    countUp(xpStatus, result.xpGained, reduced);
    (result.rematchDisabledReason ? back : rematch).focus();
  }
}

function countUp(node: HTMLElement, text: string, reduced: boolean): void {
  const match = /(-?[\d,]+)/.exec(text);
  if (!match || reduced) {
    node.textContent = text;
    return;
  }
  const target = Number((match[1] ?? '0').replace(/,/g, ''));
  const start = performance.now();
  const duration = 900;
  const step = (): void => {
    const progress = Math.min(1, (performance.now() - start) / duration);
    const value = Math.round(target * progress);
    node.textContent = text.replace(match[1] as string, num(value));
    if (progress < 1) requestAnimationFrame(step);
    else node.textContent = text;
  };
  node.textContent = text.replace(match[1] as string, '0');
  requestAnimationFrame(step);
}
