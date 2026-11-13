/**
 * The shock ruler. It spans −60% to +60% of the chosen asset's posted price
 * and draws one tick per open position collateralised in that asset, at that
 * position's server liquidation price.
 */

import { assetDecimals, type Asset } from '../../domain/assets.ts';
import { formatAmount, formatPrice, formatShock } from '../../domain/deskformat.ts';
import {
  isAtRisk,
  shockedPrice,
  SHOCK_MAX_TENTHS,
  SHOCK_MIN_TENTHS,
  SHOCK_STEP_TENTHS,
} from '../../domain/shock.ts';
import { clear, el, labelled, prefersReducedMotion, setText } from '../dom.ts';
import { priceUnitsOf } from '../prices.ts';
import type { PositionDto } from '../types.ts';

/** The pause after the last movement before the reading is announced. */
const SETTLE_MS = 400;

/** Shift with an arrow moves five percent. */
const SHIFT_STEP_TENTHS = 50;

interface Tick {
  readonly positionId: string;
  readonly liquidationPrice: bigint;
  readonly collateral: bigint;
  readonly element: HTMLElement | null;
  atRisk: boolean;
}

export interface ShockRulerOptions {
  /** The steward's ruler shows Post this price; every other one does not. */
  readonly showPost: boolean;
  /** On the position page the owner's own tick is drawn taller. */
  readonly ownPositionId?: string;
  readonly onPost?: (shockedPriceUnits: bigint) => void;
}

export class ShockRuler {
  readonly element: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly handle: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly tickList: HTMLElement;
  private readonly reading: HTMLElement;
  private readonly atRiskValue: HTMLElement;
  private readonly exposedValue: HTMLElement;
  private readonly shockedValue: HTMLElement;
  private readonly postButton: HTMLButtonElement | null;

  private asset: Asset = 'MBTC';
  private price = 0n;
  private positions: readonly PositionDto[] = [];
  private ticks: Tick[] = [];
  private shockTenths = 0;
  private settleTimer: number | null = null;
  private dragging = false;
  /** What the ticks were last drawn for, so they redraw only when it changes. */
  private drawnFor = '';

  constructor(private readonly options: ShockRulerOptions) {
    this.slider = el('input', {
      type: 'range',
      min: String(SHOCK_MIN_TENTHS / 10),
      max: String(SHOCK_MAX_TENTHS / 10),
      step: String(SHOCK_STEP_TENTHS / 10),
      value: '0',
      class: 'shock-slider',
      'aria-label': 'Price shock',
    });
    this.handle = el('span', {
      class: 'shock-handle',
      role: 'img',
      'aria-label': 'Shock handle',
    });
    this.canvas = el('div', {
      class: 'shock-canvas',
      role: 'img',
      'aria-label': 'Liquidation prices of open positions',
    });
    this.tickList = el('ul', {
      class: 'shock-ticks visually-hidden',
      'aria-label': 'Position ticks',
    });
    this.reading = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Shock reading',
      class: 'shock-reading',
    });

    const atRisk = labelled('Positions at risk');
    const exposed = labelled('Collateral exposed');
    const shocked = labelled('Shocked price');
    this.atRiskValue = atRisk.value;
    this.exposedValue = exposed.value;
    this.shockedValue = shocked.value;

    this.postButton = options.showPost
      ? el('button', { type: 'button', class: 'action', text: 'Post this price' })
      : null;

    const track = el('div', { class: 'shock-track' }, [this.canvas, this.handle, this.slider]);

    this.element = el('section', { class: 'shock-ruler', 'aria-label': 'Shock ruler' }, [
      el('h2', { class: 'zone-head', text: 'Shock ruler' }),
      track,
      el('div', { class: 'shock-figures' }, [atRisk.row, exposed.row, shocked.row]),
      this.tickList,
      this.reading,
      ...(this.postButton === null ? [] : [this.postButton]),
    ]);
    this.element.setAttribute('role', 'region');

    this.wireKeyboard();
    this.wirePointer();
    if (this.postButton !== null) {
      this.postButton.addEventListener('click', () => {
        this.options.onPost?.(this.shockedPriceNow());
      });
    }
  }

  /** The slider is the ruler's own input and keeps focus throughout. */
  private wireKeyboard(): void {
    this.slider.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? SHIFT_STEP_TENTHS : SHOCK_STEP_TENTHS;
      let next: number | null = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
        next = this.shockTenths - step;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
        next = this.shockTenths + step;
      else if (event.key === 'Home') next = SHOCK_MIN_TENTHS;
      else if (event.key === 'End') next = SHOCK_MAX_TENTHS;
      if (next === null) return;
      event.preventDefault();
      this.moveTo(next);
    });
    // Pointer and touch input arrive through the native slider too.
    this.slider.addEventListener('input', () => {
      this.moveTo(Math.round(Number(this.slider.value) * 10));
    });
    this.slider.addEventListener('pointerdown', () => {
      this.dragging = true;
    });
    const release = (): void => {
      this.dragging = false;
    };
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
    this.slider.addEventListener('blur', release);
  }

  private wirePointer(): void {
    // Pressing anywhere on the ruler moves the handle there.
    this.canvas.addEventListener('pointerdown', (event) => {
      const bounds = this.slider.getBoundingClientRect();
      if (bounds.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const raw = SHOCK_MIN_TENTHS + ratio * (SHOCK_MAX_TENTHS - SHOCK_MIN_TENTHS);
      this.moveTo(Math.round(raw / SHOCK_STEP_TENTHS) * SHOCK_STEP_TENTHS);
      this.slider.focus();
    });
  }

  /** Clamps to the span and snaps to half-percent steps. */
  private moveTo(tenths: number): void {
    const snapped = Math.round(tenths / SHOCK_STEP_TENTHS) * SHOCK_STEP_TENTHS;
    const next = Math.min(SHOCK_MAX_TENTHS, Math.max(SHOCK_MIN_TENTHS, snapped));
    if (next === this.shockTenths) {
      this.slider.value = String(next / 10);
      return;
    }
    this.shockTenths = next;
    this.slider.value = String(next / 10);
    this.paint();
    this.scheduleReading();
  }

  private shockedPriceNow(): bigint {
    return shockedPrice(this.price, this.shockTenths);
  }

  /** Loads the positions this ruler draws, for the chosen asset. */
  setData(asset: Asset, priceUnits: bigint, positions: readonly PositionDto[]): void {
    const assetChanged = asset !== this.asset;
    this.asset = asset;
    const priceChanged = priceUnits !== this.price;
    this.price = priceUnits;
    this.positions = positions.filter(
      (position) =>
        position.collateral_asset === asset &&
        position.liquidation_price !== null &&
        BigInt(position.debt) > 0n,
    );
    if (assetChanged || priceChanged) this.shockTenths = 0;
    this.slider.value = String(this.shockTenths / 10);
    this.paint();
  }

  /** True while the handle is being dragged, when the refresh stands off. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Recentres at 0% on the new price, as every ruler does after a post. */
  recentre(): void {
    this.shockTenths = 0;
    this.slider.value = '0';
    this.paint();
  }

  /**
   * Redraws the ticks when the asset or the positions changed, and otherwise
   * only moves the handle and repaints the fills.
   */
  private paint(): void {
    const signature = `${this.asset}|${this.price}|${this.positions
      .map((position) => `${position.position_id}:${position.liquidation_price}`)
      .join(',')}`;
    if (signature !== this.drawnFor) {
      this.drawnFor = signature;
      this.rebuildTicks();
    }

    const shocked = this.shockedPriceNow();
    const reduced = prefersReducedMotion();
    let atRiskCount = 0;
    let exposed = 0n;

    for (const tick of this.ticks) {
      const atRisk = isAtRisk(shocked, tick.liquidationPrice);
      if (atRisk) {
        atRiskCount += 1;
        exposed += tick.collateral;
      }
      if (tick.atRisk !== atRisk && tick.element !== null) {
        tick.element.classList.toggle('at-risk', atRisk);
        tick.element.classList.toggle('hatched', atRisk && reduced);
      }
      tick.atRisk = atRisk;
    }

    // The handle sits over the slider's current value.
    const ratio = (this.shockTenths - SHOCK_MIN_TENTHS) / (SHOCK_MAX_TENTHS - SHOCK_MIN_TENTHS);
    this.handle.style.left = `${ratio * 100}%`;

    setText(this.atRiskValue, String(atRiskCount));
    setText(
      this.exposedValue,
      `${formatAmount(exposed, assetDecimals(this.asset))} ${this.asset}`,
    );
    setText(this.shockedValue, formatPrice(shocked));
    this.slider.setAttribute(
      'aria-valuetext',
      `${formatShock(this.shockTenths)}% \u00B7 ${formatPrice(shocked)}`,
    );
    this.renderTickList();
  }

  private rebuildTicks(): void {
    clear(this.canvas);
    const low = (this.price * 400n) / 1000n;
    const high = (this.price * 1600n) / 1000n;
    const span = high - low;
    this.ticks = this.positions.map((position) => {
      const liquidationPrice = priceUnitsOf(position.liquidation_price ?? '0.00000000');
      let element: HTMLElement | null = null;
      // Positions whose liquidation price lies outside the span are not drawn,
      // but they are counted and listed when at risk.
      if (span > 0n && liquidationPrice >= low && liquidationPrice <= high) {
        const ratio = Number(((liquidationPrice - low) * 10000n) / span) / 10000;
        element = el('span', {
          class:
            position.position_id === this.options.ownPositionId
              ? 'shock-tick own'
              : 'shock-tick',
        });
        element.style.left = `${ratio * 100}%`;
        this.canvas.append(element);
      }
      return {
        positionId: position.position_id,
        liquidationPrice,
        collateral: BigInt(position.collateral_amount),
        element,
        atRisk: false,
      };
    });
  }

  private renderTickList(): void {
    const wanted = this.ticks.map(
      (tick) =>
        `${tick.positionId}: ${formatPrice(tick.liquidationPrice)}, ${tick.atRisk ? 'at risk' : 'clear'}`,
    );
    const current = Array.from(this.tickList.children).map((child) => child.textContent ?? '');
    if (current.join('\u0000') === wanted.join('\u0000')) return;
    clear(this.tickList);
    for (const line of wanted) this.tickList.append(el('li', { text: line }));
  }

  /** The reading is announced only once the handle has settled. */
  private scheduleReading(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      const count = this.ticks.filter((tick) => tick.atRisk).length;
      const noun = count === 1 ? '1 position' : `${count} positions`;
      setText(this.reading, `${noun} at risk at ${formatShock(this.shockTenths)}% shock.`);
    }, SETTLE_MS);
  }

  focusSlider(): void {
    this.slider.focus();
  }
}
