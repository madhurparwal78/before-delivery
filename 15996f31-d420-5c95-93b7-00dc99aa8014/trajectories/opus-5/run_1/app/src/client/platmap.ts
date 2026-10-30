import { NOT_INSPECTED_LABEL, tierLabel, type Tier } from '../shared/labels';
import { el, reducedMotion } from './core';
import { icon } from './icons';
import { AVERAGE_TIMING, Odometer } from './odometer';
import { tierPattern } from './patterns';

export const TIER_SWAP_DELAY_MS = 300;
export const TIER_SWAP_MS = 300;
const MAX_ROWS = 3;
const NO_READING = '—';

export interface PlatBlockInput {
  id: string;
  name: string;
  acres: number;
  averageFrames: number | null;
  tier: Tier | null;
}

interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Parcels tiled across up to three rows, each block's area set by its acres. */
function layout(blocks: readonly PlatBlockInput[]): Placement[] {
  const rows = Math.max(1, Math.min(MAX_ROWS, Math.ceil(blocks.length / 3)));
  const groups: PlatBlockInput[][] = [];
  let placed = 0;
  for (let row = 0; row < rows; row += 1) {
    const take = Math.ceil((blocks.length - placed) / (rows - row));
    groups.push(blocks.slice(placed, placed + take));
    placed += take;
  }
  const acresOf = (group: readonly PlatBlockInput[]): number =>
    group.reduce((total, block) => total + Math.max(block.acres, 0.1), 0);
  const totalAcres = acresOf(blocks);
  const placements: Placement[] = [];
  let top = 0;
  for (const group of groups) {
    const groupAcres = acresOf(group);
    const height = (groupAcres / totalAcres) * 100;
    let left = 0;
    for (const block of group) {
      const width = (Math.max(block.acres, 0.1) / groupAcres) * 100;
      placements.push({ left, top, width, height });
      left += width;
    }
    top += height;
  }
  return placements;
}

export function averageText(averageFrames: number | null): string | null {
  return averageFrames === null ? null : averageFrames.toFixed(1);
}

export class BlockCell {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly meter: HTMLElement;
  private readonly odometer: Odometer;
  private readonly chip: HTMLElement;
  private shownTier: Tier | null;
  private shownAverage: string | null;

  constructor(
    readonly blockId: string,
    readonly name: string,
    input: PlatBlockInput,
  ) {
    this.shownTier = input.tier;
    this.shownAverage = averageText(input.averageFrames);
    this.odometer = new Odometer('plat__digits', this.shownAverage ?? NO_READING);
    this.button = el('button', {
      type: 'button',
      class: 'plat__hit',
      'aria-pressed': 'false',
      'aria-label': this.buttonName(),
    });
    this.chip = el('span', { class: 'plat__tier', text: tierLabel(this.shownTier) });
    this.meter = el('div', {
      class: 'plat__meter',
      role: 'meter',
      'aria-label': `Average frames, ${name}`,
      'aria-valuemin': '0',
      'aria-valuemax': '20',
      'aria-valuenow': String(input.averageFrames ?? 0),
      'aria-valuetext': this.meterText(),
    });
    this.meter.append(this.odometer.element);
    this.root = el('div', { class: 'plat__block', 'data-block': blockId }, [
      this.button,
      el('span', { class: 'plat__name', text: name }),
      this.meter,
      this.chip,
    ]);
    this.paint();
  }

  private buttonName(): string {
    return this.shownAverage === null
      ? `${this.name}, ${NOT_INSPECTED_LABEL}`
      : `${this.name}, ${tierLabel(this.shownTier)}, ${this.shownAverage} frames`;
  }

  private meterText(): string {
    return this.shownAverage === null
      ? NOT_INSPECTED_LABEL
      : `${this.shownAverage} frames, ${tierLabel(this.shownTier)}`;
  }

  private paint(): void {
    this.root.dataset.tier = this.shownTier ?? 'none-yet';
    this.root.style.backgroundImage = tierPattern(this.shownTier);
    this.chip.textContent = tierLabel(this.shownTier);
    this.button.setAttribute('aria-label', this.buttonName());
    this.meter.setAttribute('aria-valuetext', this.meterText());
  }

  place(placement: Placement): void {
    this.root.style.left = `${placement.left}%`;
    this.root.style.top = `${placement.top}%`;
    this.root.style.width = `${placement.width}%`;
    this.root.style.height = `${placement.height}%`;
  }

  set selected(value: boolean) {
    this.root.dataset.selected = value ? 'true' : 'false';
    this.button.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  get currentAverage(): string | null {
    return this.shownAverage;
  }

  get currentTier(): Tier | null {
    return this.shownTier;
  }

  set provisional(value: boolean) {
    this.odometer.dimmed = value;
  }

  /** Rolls the readout, then swaps the tier pattern and label once it settles. */
  applyStrength(
    averageFrames: number | null,
    tier: Tier | null,
    onDigitsSettled?: () => void,
  ): void {
    const next = averageText(averageFrames);
    const tierChanged = tier !== this.shownTier;
    this.meter.setAttribute('aria-valuenow', String(averageFrames ?? 0));
    if (next === null) {
      this.shownAverage = null;
      this.shownTier = tier;
      this.odometer.set(NO_READING);
      this.paint();
      onDigitsSettled?.();
      return;
    }
    if (this.shownAverage === null) this.odometer.set((0).toFixed(1));
    this.shownAverage = next;
    this.meter.setAttribute(
      'aria-valuetext',
      `${next} frames, ${tierLabel(tier ?? this.shownTier)}`,
    );
    this.odometer.roll(next, AVERAGE_TIMING, () => {
      if (!tierChanged) {
        this.shownTier = tier;
        this.paint();
        onDigitsSettled?.();
        return;
      }
      const swap = (): void => {
        this.shownTier = tier;
        this.root.classList.add('plat__block--swapping');
        this.paint();
        window.setTimeout(() => this.root.classList.remove('plat__block--swapping'), TIER_SWAP_MS);
      };
      if (reducedMotion()) swap();
      else window.setTimeout(swap, TIER_SWAP_DELAY_MS);
      onDigitsSettled?.();
    });
  }

  /** Rolls back to the figures shown before a refused change. */
  rollBack(averageFrames: number | null, tier: Tier | null): void {
    const next = averageText(averageFrames);
    this.shownAverage = next;
    this.shownTier = tier;
    this.meter.setAttribute('aria-valuenow', String(averageFrames ?? 0));
    if (next === null) this.odometer.set(NO_READING);
    else this.odometer.roll(next, AVERAGE_TIMING);
    this.paint();
  }
}

export class PlatMap {
  readonly element: HTMLElement;
  private readonly surface: HTMLElement;
  private cells = new Map<string, BlockCell>();
  private order: string[] = [];

  constructor(
    orchardName: string,
    private readonly onSelect: (blockId: string) => void,
  ) {
    this.surface = el('div', { class: 'plat__surface' });
    this.element = el(
      'div',
      {
        class: 'plat',
        role: 'group',
        'aria-label': `Plat map, ${orchardName}`,
        tabindex: '-1',
        id: 'plat-map',
      },
      [
        this.surface,
        el('span', { class: 'plat__north', 'aria-hidden': 'true' }, [icon('compass'), 'N']),
        el('span', {
          class: 'plat__scale',
          text: 'Parcel areas drawn in proportion to acres',
        }),
      ],
    );
  }

  setOrchardName(orchardName: string): void {
    this.element.setAttribute('aria-label', `Plat map, ${orchardName}`);
  }

  /** Rebuilds the parcels when the block set changes; keeps cells otherwise. */
  setBlocks(blocks: readonly PlatBlockInput[]): void {
    const signature = blocks.map((block) => `${block.id}:${block.acres}`).join('|');
    if (this.surface.dataset.signature !== signature) {
      this.surface.dataset.signature = signature;
      this.surface.replaceChildren();
      this.cells = new Map();
      this.order = [];
      const placements = layout(blocks);
      blocks.forEach((block, index) => {
        const cell = new BlockCell(block.id, block.name, block);
        cell.place(placements[index] as Placement);
        cell.button.addEventListener('click', () => this.onSelect(block.id));
        this.surface.append(cell.root);
        this.cells.set(block.id, cell);
        this.order.push(block.id);
      });
    }
  }

  cell(blockId: string): BlockCell | undefined {
    return this.cells.get(blockId);
  }

  blockIds(): readonly string[] {
    return this.order;
  }

  select(blockId: string | null): void {
    for (const [id, cell] of this.cells) cell.selected = id === blockId;
  }
}
