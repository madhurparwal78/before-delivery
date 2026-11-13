import { deskAmountOf, deskPriceOf, deskShock, scaledFromDecimal } from './desk.js';
import type { AssetCode, Position } from './types.js';
import { createEl } from './ui.js';

export interface ShockRulerOptions {
  asset: AssetCode;
  positionId?: string;
  canPost: boolean;
  onPost?: (shockedPriceApi: string) => void;
  onAssetLoaded?: (positions: Position[]) => void;
}

interface TickEntry {
  positionId: string;
  liquidationPrice: bigint;
  atRiskAtZero: boolean;
  isOwner: boolean;
}

/**
 * The shock ruler: a native slider spanning ±60%, a canvas of liquidation-price ticks,
 * both counters, and the settled reading announcement.
 */
export class ShockRuler {
  private readonly root: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly handle: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hiddenList: HTMLUListElement;
  private readonly atRisk: HTMLElement;
  private readonly exposed: HTMLElement;
  private readonly shockedPrice: HTMLElement;
  private readonly reading: HTMLElement;
  private readonly options: ShockRulerOptions;
  private ticks: TickEntry[] = [];
  private basePrice = 0n;
  private shockTenths = 0;
  private readingTimer: ReturnType<typeof setTimeout> | null = null;
  private changed = false;

  constructor(container: HTMLElement, options: ShockRulerOptions) {
    this.options = options;
    const region = createEl('div', 'Shock ruler', 'shockruler');
    region.setAttribute('role', 'region');
    this.root = region;

    const heading = document.createElement('h3');
    heading.textContent = 'Price shock';
    region.append(heading);

    const readout = createEl('div', '', 'readout');
    this.atRisk = labelledValue(readout, 'Positions at risk', '0');
    this.exposed = labelledValue(readout, 'Collateral exposed', `0 ${options.asset}`);
    this.shockedPrice = labelledValue(readout, 'Shocked price', '$0');
    region.append(readout);

    const sliderWrap = createEl('div', '', 'sliderwrap');
    const track = createEl('div', '', 'track');
    this.handle = createEl('div', 'Shock handle', 'handle');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ticks';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Liquidation prices of open positions');
    sliderWrap.append(track, this.handle, this.canvas);

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '-60';
    this.slider.max = '60';
    this.slider.step = '0.5';
    this.slider.value = '0';
    this.slider.setAttribute('aria-label', 'Price shock');
    sliderWrap.append(this.slider);
    region.append(sliderWrap);

    this.hiddenList = document.createElement('ul');
    this.hiddenList.setAttribute('aria-label', 'Position ticks');
    this.hiddenList.className = 'sr-only';
    region.append(this.hiddenList);

    this.reading = createEl('div', 'Shock reading', 'status-role');
    this.reading.setAttribute('role', 'status');
    this.reading.textContent = 'Shock at 0,0%.';
    region.append(this.reading);

    if (options.canPost) {
      const post = createEl('button', 'Post this price', '', 'Post this price');
      post.addEventListener('click', (): void => {
        this.options.onPost?.(this.shockedPriceApi());
      });
      region.append(post);
    }

    container.append(region);
    this.attach();
  }

  private attach(): void {
    this.slider.addEventListener('input', (): void => {
      const value = Number.parseFloat(this.slider.value);
      this.setShock(Math.round(value * 10));
    });
    this.slider.addEventListener('keydown', (event): void => {
      const key = event.key;
      let next: number | null = null;
      if (key === 'ArrowLeft' || key === 'ArrowDown') next = event.shiftKey ? this.shockTenths - 50 : this.shockTenths - 5;
      if (key === 'ArrowRight' || key === 'ArrowUp') next = event.shiftKey ? this.shockTenths + 50 : this.shockTenths + 5;
      if (key === 'Home') next = -600;
      if (key === 'End') next = 600;
      if (next !== null) {
        event.preventDefault();
        const clamped = Math.max(-600, Math.min(600, next));
        this.slider.value = (clamped / 10).toString();
        this.setShock(clamped);
      }
    });
  }

  setPositions(positions: Position[], basePrice: string): void {
    this.basePrice = scaledFromDecimal(basePrice, 8);
    this.ticks = positions
      .filter((position): boolean => position.debt !== '0' && position.liquidation_price !== null)
      .map((position): TickEntry => ({
        positionId: position.position_id,
        liquidationPrice: scaledFromDecimal(position.liquidation_price ?? '0', 8),
        atRiskAtZero: position.health_factor !== null && Number.parseFloat(position.health_factor) < 1,
        isOwner: position.position_id === this.options.positionId,
      }));
    this.changed = true;
    this.update(true);
    this.options.onAssetLoaded?.(positions);
  }

  recenter(basePrice: string): void {
    this.basePrice = scaledFromDecimal(basePrice, 8);
    this.shockTenths = 0;
    this.slider.value = '0';
    this.changed = true;
    this.update(true);
  }

  shockedPriceApi(): string {
    const scaled = this.shockedPriceValue();
    return decimalFromScaled(scaled, 8);
  }

  private setShock(tenths: number): void {
    this.shockTenths = tenths;
    this.update(false);
    if (this.readingTimer !== null) clearTimeout(this.readingTimer);
    const atRiskCount = this.countAtRisk();
    this.readingTimer = setTimeout((): void => {
      this.reading.textContent = `${atRiskCount === 1 ? '1 position' : `${atRiskCount} positions`} at risk at ${deskShock(this.shockTenths)}% shock.`;
    }, 400);
  }

  private shockedPriceValue(): bigint {
    return this.basePrice * (1000n + BigInt(this.shockTenths)) / 1000n;
  }

  private countAtRisk(): number {
    const shocked = this.shockedPriceValue();
    let count = 0;
    for (const tick of this.ticks) {
      if (shocked < tick.liquidationPrice) count += 1;
    }
    return count;
  }

  private update(reannounce: boolean): void {
    const shocked = this.shockedPriceValue();
    const leftPercent = ((this.shockTenths + 600) / 1200) * 100;
    this.handle.style.left = `${leftPercent}%`;
    const valueText = `${deskShock(this.shockTenths)}% \u00b7 ${deskPriceOf(this.shockedPriceApi())}`;
    this.slider.setAttribute('aria-valuetext', valueText);
    this.atRisk.textContent = this.countAtRisk().toString();
    let exposed = 0n;
    const atRiskIds: string[] = [];
    for (const tick of this.ticks) {
      if (shocked < tick.liquidationPrice) {
        exposed += this.collateralOf(tick.positionId);
        atRiskIds.push(tick.positionId);
      }
    }
    this.exposed.textContent = `${deskAmountOf(exposed.toString(), this.options.asset)} ${this.options.asset}`;
    this.shockedPrice.textContent = deskPriceOf(this.shockedPriceApi());
    this.hiddenList.replaceChildren();
    for (const tick of this.ticks) {
      const li = document.createElement('li');
      const atRisk = shocked < tick.liquidationPrice;
      li.textContent = `${tick.positionId}: ${deskPriceOf(tick.liquidationPrice.toString())}, ${atRisk ? 'at risk' : 'clear'}`;
      this.hiddenList.append(li);
    }
    this.drawCanvas(shocked);
    if (reannounce) {
      const atRiskCount = this.countAtRisk();
      this.reading.textContent = `${atRiskCount === 1 ? '1 position' : `${atRiskCount} positions`} at risk at ${deskShock(this.shockTenths)}% shock.`;
    }
  }

  private collateralByPosition = new Map<string, string>();

  recordCollateral(positions: Position[]): void {
    for (const position of positions) {
      this.collateralByPosition.set(position.position_id, position.collateral_amount);
    }
  }

  private collateralOf(positionId: string): bigint {
    return BigInt(this.collateralByPosition.get(positionId) ?? '0');
  }

  private drawCanvas(shocked: bigint): void {
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    const width = this.canvas.clientWidth || 300;
    const height = 44;
    this.canvas.width = width;
    this.canvas.height = height;
    context.clearRect(0, 0, width, height);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const span = this.basePrice * 600n / 1000n;
    const lower = this.basePrice - span;
    const upper = this.basePrice + span;
    const xFor = (price: bigint): number => {
      const fraction = Number((price - lower) * 10000n / (upper - lower)) / 10000;
      return fraction * width;
    };
    for (const tick of this.ticks) {
      if (tick.liquidationPrice < lower || tick.liquidationPrice > upper) continue;
      const x = xFor(tick.liquidationPrice);
      const crossed = shocked < tick.liquidationPrice;
      const red = crossed || tick.atRiskAtZero;
      const tickHeight = tick.isOwner ? 32 : 20;
      const top = (height - tickHeight) / 2;
      if (red) {
        context.fillStyle = '#a4372c';
      } else {
        context.fillStyle = '#16232e';
      }
      context.fillRect(Math.max(0, Math.min(width - 2, x)), top, 1.5, tickHeight);
      if (red && reduced) {
        context.save();
        context.strokeStyle = '#a4372c';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(Math.max(0, Math.min(width - 2, x)) - 2, top + tickHeight);
        context.lineTo(Math.max(0, Math.min(width - 2, x)) + 2, top);
        context.stroke();
        context.restore();
      }
    }
    void this.changed;
    this.changed = false;
  }
}

/** Render scaled price units back into the API decimal form. */
function decimalFromScaled(scaled: bigint, decimals: number): string {
  const base = scaled.toString().padStart(decimals + 1, '0');
  return `${base.slice(0, base.length - decimals)}.${base.slice(base.length - decimals)}`;
}

function labelledValue(container: HTMLElement, label: string, initial: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kv';
  const key = document.createElement('span');
  key.className = 'k';
  key.textContent = label;
  const value = document.createElement('span');
  value.className = 'v num';
  value.textContent = initial;
  row.append(key, value);
  container.append(row);
  return value;
}
