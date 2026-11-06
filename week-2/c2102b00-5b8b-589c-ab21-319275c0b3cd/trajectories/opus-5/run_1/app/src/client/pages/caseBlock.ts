import type { Line } from '../../shared/types.ts';
import { el, isBusy, prefersReducedMotion, setAttribute, setBusy, setText } from '../dom.ts';
import { copy } from '../copy.ts';
import { formatDollars } from '../../shared/money.ts';
import { crateLabel, crateModelFromLine, gridLabel } from '../crate/model.ts';
import { CrateView, contextIsLost, onContextStateChange, webglIsAvailable } from '../crate/view.ts';
import { palette } from '../crate/palette.ts';

function priceText(line: Line): string {
  const unitPrice = Math.ceil(line.price_cents / line.pack);
  return `$${formatDollars(line.price_cents)} a case, $${formatDollars(unitPrice)} a unit`;
}

const CELL_STEP_MS = 30;
const CELL_SPREAD_MS = 760;
const CELL_CHANGE_MS = 180;
const NUMERAL_MS = 300;
const LID_MS = 300;
const STAMP_MS = 170;

export interface CaseBlockHost {
  pledge: (block: CaseBlock, units: number) => void;
  openWithdraw: (block: CaseBlock) => void;
  onSealChange: (block: CaseBlock, sealed: boolean, byOwnChange: boolean) => void;
}

interface Effect {
  unitProgress: number[];
  lidProgress: number;
  stampProgress: number;
}

export class CaseBlock {
  readonly article: HTMLElement;
  readonly productId: string;
  line: Line;
  private readonly host: CaseBlockHost;
  private readonly heading: HTMLElement;
  private readonly price: HTMLElement;
  private readonly numeral: HTMLElement;
  private readonly stateText: HTMLElement;
  private readonly grid: HTMLElement;
  private cells: HTMLElement[] = [];
  private readonly crateHolder: HTMLElement;
  private readonly turnStrip: HTMLElement;
  private readonly slider: HTMLInputElement | null;
  private readonly unitsText: HTMLElement;
  private readonly spin: HTMLInputElement;
  private readonly fewer: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private readonly pledgeButton: HTMLButtonElement;
  private withdrawButton: HTMLButtonElement | null = null;
  private readonly controls: HTMLElement;
  private readonly notice: HTMLElement;
  readonly crate: CrateView;
  private stepped = false;
  private sequenceToken = 0;
  private pendingRetry: { key: string; units: number } | null = null;
  private pledgeInFlight = false;
  private dropContextWatch: () => void;

  constructor(line: Line, host: CaseBlockHost) {
    this.line = line;
    this.productId = line.product_id;
    this.host = host;

    this.heading = el('h2', { class: 'case-name', text: line.case_name });
    this.price = el('p', { class: 'case-price', text: priceText(line) });
    this.numeral = el('p', { class: 'case-numeral' }, [
      el('span', { class: 'numeral-value', text: `${line.units_to_go} to go` }),
      el('span', { class: 'label', text: 'TO GO' }),
    ]);
    this.stateText = el('p', { class: 'case-state' });
    this.grid = el('div', { class: 'case-grid', role: 'img', 'aria-label': gridLabel(line) });
    this.buildCells();

    this.crate = new CrateView(crateModelFromLine(line), crateLabel(line), {
      background: () => (this.isSealedLook() ? palette.green : palette.kraft),
      isVisible: () => this.article.offsetParent !== null || this.article.isConnected,
    });
    this.crateHolder = el('div', { class: 'crate-holder' }, [this.crate.canvas]);
    if (webglIsAvailable()) {
      this.slider = el('input', {
        type: 'range',
        class: 'turn-slider',
        min: '-75',
        max: '75',
        step: '1',
        value: '0',
        'aria-label': `Turn crate of ${line.case_name}`,
        'aria-valuemin': '-75',
        'aria-valuemax': '75',
        'aria-valuenow': '0',
      }) as HTMLInputElement;
      this.turnStrip = el('div', { class: 'turn-strip' }, [
        el('span', { class: 'label', text: 'TURN' }),
        this.slider,
      ]);
    } else {
      this.slider = null;
      this.turnStrip = el('div', { class: 'turn-strip is-absent' });
    }

    this.unitsText = el('p', { class: 'case-mine' });
    this.spin = el('input', {
      type: 'number',
      class: 'units-spin',
      min: '0',
      step: '1',
      'aria-label': `Units of ${line.case_name}`,
    }) as HTMLInputElement;
    this.fewer = el('button', {
      type: 'button',
      class: 'step-button',
      'aria-label': `Fewer units of ${line.case_name}`,
      text: '\u2212',
    }) as HTMLButtonElement;
    this.more = el('button', {
      type: 'button',
      class: 'step-button',
      'aria-label': `More units of ${line.case_name}`,
      text: '+',
    }) as HTMLButtonElement;
    this.pledgeButton = el('button', {
      type: 'button',
      class: 'primary pledge-button',
      'aria-label': `Pledge ${line.case_name}`,
      text: 'Pledge',
    }) as HTMLButtonElement;
    this.controls = el('div', { class: 'case-controls' }, [this.fewer, this.spin, this.more, this.pledgeButton]);
    this.notice = el('p', { class: 'case-notice', hidden: true });

    this.article = el('article', { class: 'case-block', 'data-product': line.product_id }, [
      this.heading,
      this.price,
      this.numeral,
      this.stateText,
      el('div', { class: 'case-middle' }, [this.grid, el('div', { class: 'crate-column' }, [this.crateHolder, this.turnStrip])]),
      this.notice,
      this.unitsText,
      this.controls,
    ]);
    this.article.setAttribute('aria-labelledby', '');
    this.heading.id = `case-heading-${line.product_id}`;
    this.article.setAttribute('aria-labelledby', this.heading.id);

    this.wireControls();
    this.dropContextWatch = onContextStateChange((lost) => this.applyContextState(lost));
    this.applyContextState(contextIsLost());
    this.drawLine(line, 'instant');
  }

  private buildCells(): void {
    this.cells = [];
    const model = crateModelFromLine(this.line);
    this.grid.style.setProperty('--columns', String(model.columns));
    for (let index = 0; index < this.line.pack; index += 1) {
      const cell = el('span', { class: 'case-cell', 'data-cell': this.line.cells[index] ?? 'empty' });
      this.cells.push(cell);
      this.grid.append(cell);
    }
  }

  private wireControls(): void {
    this.fewer.addEventListener('click', () => this.stepBy(-1));
    this.more.addEventListener('click', () => this.stepBy(1));
    this.spin.addEventListener('input', () => {
      this.stepped = true;
      this.syncSpinAria();
    });
    this.spin.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.submit();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        this.setUnitsValue(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        this.setUnitsValue(this.maxUnits());
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.stepBy(1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.stepBy(-1);
      }
    });
    this.pledgeButton.addEventListener('click', () => this.submit());
    if (this.slider) {
      const slider = this.slider;
      slider.addEventListener('input', () => {
        this.crate.setTurn(Number(slider.value));
        this.syncSliderAria();
      });
      slider.addEventListener('keydown', (event) => {
        const steps: Record<string, number> = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15 };
        const step = steps[event.key];
        if (step !== undefined) {
          event.preventDefault();
          this.applyTurn(this.crate.turnDegrees + step);
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          this.applyTurn(-75);
        } else if (event.key === 'End') {
          event.preventDefault();
          this.applyTurn(75);
        }
      });
    }
    this.wireCrateDrag();
  }

  private wireCrateDrag(): void {
    const canvas = this.crate.canvas;
    let pointerId: number | null = null;
    let startX = 0;
    let startTurn = 0;
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.slider || contextIsLost()) return;
      if (event.pointerType === 'touch') return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startTurn = this.crate.turnDegrees;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      this.applyTurn(startTurn + (event.clientX - startX) * 0.5);
    });
    const endDrag = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    let touchStartX = 0;
    let touchStartY = 0;
    let touchTurn = 0;
    let axis: 'none' | 'horizontal' | 'vertical' = 'none';
    canvas.addEventListener(
      'touchstart',
      (event) => {
        if (!this.slider || contextIsLost()) return;
        const touch = event.touches[0];
        if (!touch) return;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchTurn = this.crate.turnDegrees;
        axis = 'none';
      },
      { passive: true },
    );
    canvas.addEventListener(
      'touchmove',
      (event) => {
        if (!this.slider || contextIsLost()) return;
        const touch = event.touches[0];
        if (!touch) return;
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        if (axis === 'none') {
          if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
          axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
        }
        if (axis === 'vertical') return;
        event.preventDefault();
        this.applyTurn(touchTurn + deltaX * 0.5);
      },
      { passive: false },
    );
  }

  private applyTurn(degrees: number): void {
    const clamped = Math.max(-75, Math.min(75, degrees));
    this.crate.setTurn(clamped);
    if (this.slider) {
      this.slider.value = String(Math.round(clamped));
      this.syncSliderAria();
    }
  }

  private syncSliderAria(): void {
    if (!this.slider) return;
    setAttribute(this.slider, 'aria-valuenow', String(Math.round(this.crate.turnDegrees)));
  }

  private syncSpinAria(): void {
    setAttribute(this.spin, 'aria-valuenow', this.spin.value === '' ? '0' : this.spin.value);
  }

  maxUnits(): number {
    return (this.line.my_units ?? 0) + this.line.units_to_go;
  }

  get unitsValue(): number {
    const value = Number(this.spin.value);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(this.maxUnits(), Math.round(value)));
  }

  get isStepped(): boolean {
    return this.stepped;
  }

  private setUnitsValue(value: number): void {
    const clamped = Math.max(0, Math.min(this.maxUnits(), value));
    this.spin.value = String(clamped);
    this.stepped = true;
    this.syncSpinAria();
  }

  private stepBy(delta: number): void {
    this.setUnitsValue(this.unitsValue + delta);
  }

  private submit(): void {
    if (this.pledgeInFlight || isBusy(this.pledgeButton)) return;
    const units = this.unitsValue;
    if (units === 0) {
      this.host.openWithdraw(this);
      return;
    }
    this.host.pledge(this, units);
  }

  /** The key for this attempt, reused by a retry of the same units. */
  idempotencyKeyFor(units: number, fresh: () => string): string {
    if (this.pendingRetry && this.pendingRetry.units === units) return this.pendingRetry.key;
    const key = fresh();
    this.pendingRetry = { key, units };
    return key;
  }

  clearRetry(): void {
    this.pendingRetry = null;
  }

  setPledgePending(pending: boolean): void {
    this.pledgeInFlight = pending;
    setBusy(this.pledgeButton, pending, { busy: 'Saving...', idle: 'Pledge' });
  }

  setWithdrawPending(pending: boolean): void {
    if (!this.withdrawButton) return;
    setBusy(this.withdrawButton, pending, { busy: 'Saving...', idle: 'Withdraw' });
  }

  get isPledgeInFlight(): boolean {
    return this.pledgeInFlight;
  }

  setAccepting(accepting: boolean): void {
    const closed = !accepting || this.line.status === 'dropped';
    for (const control of [this.fewer, this.more, this.spin, this.pledgeButton]) {
      control.disabled = closed;
    }
    if (this.withdrawButton) this.withdrawButton.disabled = closed;
  }

  private isSealedLook(): boolean {
    return this.line.status === 'sealed' || this.line.status === 'taken_up';
  }

  get isSealed(): boolean {
    return this.isSealedLook();
  }

  focusUnits(): void {
    this.spin.focus();
  }

  get withdraw(): HTMLButtonElement | null {
    return this.withdrawButton;
  }

  get unitsControl(): HTMLInputElement {
    return this.spin;
  }

  private applyContextState(lost: boolean): void {
    if (!this.slider) return;
    if (lost) {
      this.slider.setAttribute('aria-disabled', 'true');
      this.slider.classList.add('is-paused');
    } else {
      this.slider.removeAttribute('aria-disabled');
      this.slider.classList.remove('is-paused');
    }
  }

  /** Stops a running sequence so no later step of it ever runs. */
  private cancelSequence(): void {
    this.sequenceToken += 1;
  }

  setShortNotice(shortUnits: number, myUnits: number): void {
    if (shortUnits > 0) {
      setText(this.notice, copy.shortNotice(shortUnits, myUnits));
      this.notice.hidden = false;
    } else {
      this.notice.hidden = true;
      setText(this.notice, '');
    }
  }

  private paintState(): void {
    const status = this.line.status;
    setText(this.heading, this.line.case_name);
    setText(this.price, priceText(this.line));
    this.article.classList.toggle('is-sealed', this.isSealedLook());
    this.article.classList.toggle('is-dropped', status === 'dropped');
    const stateWords =
      status === 'sealed' ? 'Sealed' : status === 'taken_up' ? 'TAKEN UP' : status === 'dropped' ? 'DROPPED' : '';
    setText(this.stateText, stateWords);
    this.stateText.hidden = stateWords === '';
    setAttribute(this.grid, 'aria-label', gridLabel(this.line));
    this.crate.setLabel(crateLabel(this.line));
    const mine = this.line.my_units ?? 0;
    setText(this.unitsText, `YOUR UNITS ${mine}`);
    setAttribute(this.spin, 'max', String(this.maxUnits()));
    setAttribute(this.spin, 'aria-valuemax', String(this.maxUnits()));
    setAttribute(this.spin, 'aria-valuemin', '0');
    if (mine > 0 && !this.withdrawButton) {
      this.withdrawButton = el('button', {
        type: 'button',
        class: 'withdraw-button',
        'aria-label': `Withdraw from ${this.line.case_name}`,
        text: 'Withdraw',
      }) as HTMLButtonElement;
        this.withdrawButton.addEventListener('click', () => {
        if (!isBusy(this.withdrawButton!)) this.host.openWithdraw(this);
      });
      this.controls.append(this.withdrawButton);
    } else if (mine === 0 && this.withdrawButton) {
      const hadFocus = document.activeElement === this.withdrawButton;
      this.withdrawButton.remove();
      this.withdrawButton = null;
      if (hadFocus) this.spin.focus();
    }
  }

  private setCell(index: number, value: string): void {
    const cell = this.cells[index];
    if (cell) setAttribute(cell, 'data-cell', value);
  }

  private setNumeral(value: number): void {
    const target = this.numeral.querySelector('.numeral-value');
    if (target) setText(target, `${value} to go`);
  }

  /** Draws a line, either straight away or through the fill-the-case sequence. */
  drawLine(line: Line, mode: 'instant' | 'sequence'): void {
    const previous = this.line;
    const previousCells = [...previous.cells];
    const wasSealed = this.isSealedLook();
    this.cancelSequence();
    this.line = line;
    if (this.stepped) {
      if (this.unitsValue > this.maxUnits()) this.spin.value = String(this.maxUnits());
    } else {
      this.spin.value = String(line.my_units ?? 0);
    }
    this.syncSpinAria();
    this.paintState();

    if (mode === 'instant' || prefersReducedMotion()) {
      line.cells.forEach((cell, index) => this.setCell(index, cell));
      this.setNumeral(line.units_to_go);
      this.crate.settle(crateModelFromLine(line), 'line');
      if (wasSealed !== this.isSealedLook()) this.host.onSealChange(this, this.isSealedLook(), mode === 'sequence');
      return;
    }
    this.runSequence(previousCells, previous.units_to_go, wasSealed);
  }

  private runSequence(previousCells: string[], previousToGo: number, wasSealed: boolean): void {
    const line = this.line;
    const token = (this.sequenceToken += 1);
    const changed: number[] = [];
    for (let index = 0; index < line.pack; index += 1) {
      if ((previousCells[index] ?? 'empty') !== (line.cells[index] ?? 'empty')) changed.push(index);
    }
    const forward = line.units_to_go < previousToGo;
    const order = forward ? changed : [...changed].reverse();
    const gap = order.length > 1 ? Math.min(CELL_STEP_MS, CELL_SPREAD_MS / (order.length - 1)) : 0;
    const cellsEnd = order.length === 0 ? 0 : (order.length - 1) * gap + CELL_CHANGE_MS;
    const unsealing = wasSealed && !this.isSealedLook();
    const sealing = !wasSealed && this.isSealedLook();
    const unsealEnd = unsealing ? STAMP_MS + LID_MS : 0;
    const numeralStart = unsealEnd + cellsEnd;
    const numeralEnd = numeralStart + NUMERAL_MS;
    const sealStart = numeralEnd;
    const sealEnd = sealing ? sealStart + LID_MS + STAMP_MS : numeralEnd;

    const startedAt = performance.now();
    const model = crateModelFromLine(line);
    const finishedUnits: number[] = line.cells.map((cell) => (cell === 'empty' ? 0 : 1));

    const settleNow = (): void => {
      line.cells.forEach((cell, index) => this.setCell(index, cell));
      this.setNumeral(line.units_to_go);
      this.article.classList.toggle('is-sealed', this.isSealedLook());
      this.crate.settle(model, 'line');
      if (wasSealed !== this.isSealedLook()) this.host.onSealChange(this, this.isSealedLook(), true);
    };
    let sealAnnounced = false;
    if (unsealing) this.article.classList.remove('is-sealed');

    const frame = (): void => {
      if (token !== this.sequenceToken) return;
      const elapsed = performance.now() - startedAt;
      const unitProgress = [...finishedUnits];

      if (unsealing) {
        const stampProgress = 1 - Math.min(1, elapsed / STAMP_MS);
        const lidProgress = 1 - Math.min(1, Math.max(0, (elapsed - STAMP_MS) / LID_MS));
        this.crate.setEffect({ unitProgress, lidProgress, stampProgress });
      }

      order.forEach((index, position) => {
        const cellStart = unsealEnd + position * gap;
        if (elapsed >= cellStart) {
          this.setCell(index, line.cells[index] ?? 'empty');
          const progress = Math.min(1, (elapsed - cellStart) / CELL_CHANGE_MS);
          if (forward && (line.cells[index] ?? 'empty') !== 'empty') unitProgress[index] = progress;
        } else {
          this.setCell(index, previousCells[index] ?? 'empty');
          if (forward) unitProgress[index] = 0;
          else unitProgress[index] = 1;
        }
      });
      if (!forward) {
        order.forEach((index, position) => {
          const cellStart = unsealEnd + position * gap;
          if (elapsed >= cellStart && (previousCells[index] ?? 'empty') !== 'empty') {
            unitProgress[index] = Math.max(0, 1 - (elapsed - cellStart) / CELL_CHANGE_MS);
          }
        });
      }

      if (elapsed >= numeralStart) {
        const progress = Math.min(1, (elapsed - numeralStart) / NUMERAL_MS);
        const value = Math.round(previousToGo + (line.units_to_go - previousToGo) * progress);
        this.setNumeral(value);
      } else {
        this.setNumeral(previousToGo);
      }

      if (sealing) {
        const lidProgress = Math.min(1, Math.max(0, (elapsed - sealStart) / LID_MS));
        const stampProgress = Math.min(1, Math.max(0, (elapsed - sealStart - LID_MS) / STAMP_MS));
        this.crate.setEffect({ unitProgress, lidProgress, stampProgress });
        if (lidProgress > 0 && !sealAnnounced) {
          sealAnnounced = true;
          this.article.classList.add('is-sealed');
          this.host.onSealChange(this, true, true);
        }
      } else if (!unsealing) {
        this.crate.setEffect({
          unitProgress,
          lidProgress: this.isSealedLook() ? 1 : 0,
          stampProgress: this.isSealedLook() ? 1 : 0,
        });
      }

      if (unsealing && elapsed >= unsealEnd && !sealAnnounced) {
        sealAnnounced = true;
        this.host.onSealChange(this, false, true);
      }

      if (elapsed >= sealEnd) {
        settleNow();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  destroy(): void {
    this.cancelSequence();
    this.dropContextWatch();
    this.crate.destroy();
    this.article.remove();
  }
}
