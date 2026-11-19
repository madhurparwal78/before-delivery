import type { FeedPin, Pin } from '../shared/types.js';
import { GRID_GAP, placeCards, type Placement } from '../shared/masonry.js';
import { copy } from '../shared/copy.js';
import { announce, el, reducedMotion } from './core.js';

export interface GridContainer {
  boardId: number;
  sectionId: number | null;
}

export interface GridOptions {
  label: string;
  selectable?: boolean;
  reorderable?: boolean;
  grouped?: boolean;
  container?: GridContainer;
  onOpen?(pin: Pin, card: HTMLElement): void;
  onSave?(pin: Pin, card: HTMLElement): void;
  onReorder?(pin: Pin, container: GridContainer, position: number): void;
  onSelectionChange?(selected: number[]): void;
  onSelectionCleared?(): void;
}

const grids = new Set<PinGrid>();

export function layoutAllGrids(): void {
  for (const grid of grids) grid.layout();
}

export function gridsInDocument(): PinGrid[] {
  return [...grids].filter((grid) => grid.element.isConnected);
}

function creditLine(pin: Pin | FeedPin): HTMLElement {
  const line = el('p', { class: 'credit' });
  const group = 'group' in pin ? pin.group : null;
  if (group && group.owners.length > 1) {
    line.textContent = copy.groupCredit(group.owners);
    return line;
  }
  const saved = pin.saved_from;
  if (!saved) {
    line.textContent = pin.owner.name;
    return line;
  }
  if (saved.pin_id !== null) {
    line.append(el('a', { href: `/pin/${saved.pin_id}`, text: `Saved from ${saved.user_name}` }));
    return line;
  }
  line.textContent = saved.removed
    ? `Saved from ${saved.user_name} · ${copy.originalRemoved}`
    : `Saved from ${saved.user_name}`;
  return line;
}

function bestVariant(pin: Pin, width: number): string {
  const variants = pin.image.variants;
  for (const variant of variants) {
    if (variant.width >= width) return variant.url;
  }
  return variants.length > 0 ? variants[variants.length - 1].url : pin.image.original_url;
}

export class PinGrid {
  readonly element: HTMLElement;
  private pins: (Pin | FeedPin)[] = [];
  private cards = new Map<number, HTMLElement>();
  private placements: Placement[] = [];
  private tabStop: number | null = null;
  private anchor: number | null = null;
  private selection = new Set<number>();
  private readonly options: GridOptions;

  constructor(options: GridOptions) {
    this.options = options;
    this.element = el('div', { class: 'grid', role: 'feed', 'aria-label': options.label });
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    grids.add(this);
  }

  destroy(): void {
    grids.delete(this);
  }

  get selected(): number[] {
    return this.orderedPins()
      .filter((pin) => this.selection.has(pin.id))
      .map((pin) => pin.id);
  }

  private orderedPins(): (Pin | FeedPin)[] {
    return this.pins;
  }

  setPins(pins: (Pin | FeedPin)[]): void {
    this.pins = pins;
    const keep = new Set(pins.map((pin) => pin.id));
    for (const [id, card] of this.cards) {
      if (!keep.has(id)) {
        card.remove();
        this.cards.delete(id);
        this.selection.delete(id);
      }
    }
    for (const pin of pins) {
      if (!this.cards.has(pin.id)) {
        const card = this.buildCard(pin);
        this.cards.set(pin.id, card);
        this.element.append(card);
      } else {
        this.refreshCard(this.cards.get(pin.id) as HTMLElement, pin);
      }
    }
    if (this.tabStop === null || !keep.has(this.tabStop)) {
      this.tabStop = pins.length > 0 ? pins[0].id : null;
    }
    this.layout();
  }

  private refreshCard(card: HTMLElement, pin: Pin | FeedPin): void {
    card.setAttribute('aria-label', `${pin.title}: ${pin.alt}`);
    const credit = card.querySelector('.credit');
    if (credit) credit.replaceWith(creditLine(pin));
    if (this.options.grouped && 'group' in pin) {
      card.dataset.groupSize = String(pin.group.size);
    }
  }

  private buildCard(pin: Pin | FeedPin): HTMLElement {
    const card = el('article', {
      class: 'card',
      'aria-label': `${pin.title}: ${pin.alt}`,
      tabindex: '-1',
    });
    card.dataset.pinId = String(pin.id);
    if (this.options.grouped && 'group' in pin) {
      card.dataset.groupSize = String(pin.group.size);
    }
    if (this.options.selectable) {
      card.setAttribute('aria-selected', 'false');
      card.dataset.selected = 'false';
    }
    const frame = el('div', { class: 'card-image' });
    const image = el('img', {
      src: bestVariant(pin, 474),
      alt: '',
      draggable: 'false',
      decoding: 'async',
    });
    image.addEventListener('error', () => {
      frame.classList.add('missing');
      if (!frame.querySelector('.unavailable')) {
        frame.append(el('p', { class: 'unavailable', text: copy.imageUnavailable }));
      }
    });
    frame.append(image);
    card.append(frame);
    card.append(el('p', { class: 'card-title', text: pin.title }));
    card.append(creditLine(pin));
    card.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (event.shiftKey && this.options.selectable) {
        this.selectRangeTo(pin.id);
        return;
      }
      this.options.onOpen?.(pin, card);
    });
    this.attachPointer(card, pin);
    return card;
  }

  layout(): void {
    const { columns, columnWidth, placements } = placeCards(
      this.pins.map((pin) => pin.image),
      window.innerWidth,
    );
    this.placements = placements;
    this.element.dataset.columns = String(columns);
    this.element.dataset.columnWidth = String(columnWidth);
    this.element.style.width = `${window.innerWidth - 2 * GRID_GAP}px`;
    let height = 0;
    placements.forEach((placement, index) => {
      const pin = this.pins[index];
      const card = this.cards.get(pin.id);
      if (!card) return;
      const width = placement.span === 2 ? 2 * columnWidth + GRID_GAP : columnWidth;
      card.dataset.order = String(placement.order);
      card.dataset.col = String(placement.col);
      card.dataset.row = String(placement.row);
      card.dataset.top = String(placement.top);
      card.dataset.height = String(placement.height);
      card.dataset.span = String(placement.span);
      card.style.width = `${width}px`;
      card.style.height = `${placement.height}px`;
      card.style.transform = `translate(${placement.col * (columnWidth + GRID_GAP)}px, ${placement.top}px)`;
      card.tabIndex = pin.id === this.tabStop ? 0 : -1;
      height = Math.max(height, placement.top + placement.height);
    });
    this.element.style.height = `${height}px`;
  }

  cardFor(pinId: number): HTMLElement | null {
    return this.cards.get(pinId) ?? null;
  }

  pinFor(pinId: number): Pin | FeedPin | null {
    return this.pins.find((pin) => pin.id === pinId) ?? null;
  }

  focusPin(pinId: number): void {
    const card = this.cards.get(pinId);
    if (!card) return;
    this.tabStop = pinId;
    this.layout();
    card.focus();
  }

  private focusedPinId(): number | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const id = active.dataset.pinId;
    return id ? Number(id) : null;
  }

  private placementOf(pinId: number): Placement | null {
    const index = this.pins.findIndex((pin) => pin.id === pinId);
    return index < 0 ? null : this.placements[index] ?? null;
  }

  private pinAtOrder(order: number): number | null {
    const placement = this.placements.find((item) => item.order === order);
    if (!placement) return null;
    return this.pins[placement.order]?.id ?? null;
  }

  private occupies(placement: Placement, column: number): boolean {
    return placement.col === column || (placement.span === 2 && placement.col + 1 === column);
  }

  private verticalTarget(from: Placement, direction: 1 | -1): number | null {
    let best: Placement | null = null;
    for (const candidate of this.placements) {
      if (candidate === from) continue;
      if (!this.occupies(candidate, from.col)) continue;
      if (direction === 1 && candidate.top <= from.top) continue;
      if (direction === -1 && candidate.top >= from.top) continue;
      if (!best) best = candidate;
      else if (direction === 1 ? candidate.top < best.top : candidate.top > best.top) best = candidate;
    }
    return best ? this.pins[best.order]?.id ?? null : null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const current = this.focusedPinId();
    if (current === null) return;
    const placement = this.placementOf(current);
    if (!placement) return;
    const pin = this.pinFor(current);
    if (!pin) return;

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (!this.options.reorderable || !this.options.container) return;
      const order = this.pins.map((item) => item.id);
      const index = order.indexOf(current);
      const next = event.key === 'ArrowUp' ? index - 1 : index + 1;
      if (next < 0 || next >= order.length) return;
      this.options.onReorder?.(pin as Pin, this.options.container, next + 1);
      return;
    }

    const move = (target: number | null): void => {
      if (target === null) return;
      event.preventDefault();
      if (event.shiftKey && this.options.selectable) {
        this.focusPin(target);
        this.selectRangeTo(target);
        return;
      }
      this.focusPin(target);
    };

    switch (event.key) {
      case 'ArrowRight':
        move(this.pinAtOrder(placement.order + 1));
        return;
      case 'ArrowLeft':
        move(this.pinAtOrder(placement.order - 1));
        return;
      case 'ArrowDown':
        move(this.verticalTarget(placement, 1));
        return;
      case 'ArrowUp':
        move(this.verticalTarget(placement, -1));
        return;
      case 'Home':
        move(this.pinAtOrder(0));
        return;
      case 'End':
        move(this.pinAtOrder(this.placements.length - 1));
        return;
      case 'Enter':
        event.preventDefault();
        this.options.onOpen?.(pin as Pin, this.cards.get(current) as HTMLElement);
        return;
      case ' ':
        if (!this.options.selectable) return;
        event.preventDefault();
        this.anchor = current;
        this.toggle(current);
        return;
      case 'Escape':
        if (this.selection.size === 0) return;
        event.preventDefault();
        this.clearSelection();
        return;
      default:
        if (event.key === 's' || event.key === 'S') {
          event.preventDefault();
          this.options.onSave?.(pin as Pin, this.cards.get(current) as HTMLElement);
        }
    }
  }

  private toggle(pinId: number): void {
    if (this.selection.has(pinId)) this.selection.delete(pinId);
    else this.selection.add(pinId);
    this.paintSelection();
  }

  private selectRangeTo(pinId: number): void {
    if (this.anchor === null) {
      this.anchor = pinId;
      this.selection.add(pinId);
      this.paintSelection();
      return;
    }
    const from = this.placementOf(this.anchor);
    const to = this.placementOf(pinId);
    if (!from || !to) return;
    const low = Math.min(from.order, to.order);
    const high = Math.max(from.order, to.order);
    this.selection.clear();
    for (let order = low; order <= high; order += 1) {
      const id = this.pinAtOrder(order);
      if (id !== null) this.selection.add(id);
    }
    this.paintSelection();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.anchor = null;
    this.paintSelection();
    announce(copy.selectionCleared);
    this.options.onSelectionCleared?.();
  }

  private paintSelection(): void {
    for (const [id, card] of this.cards) {
      const selected = this.selection.has(id);
      if (this.options.selectable) {
        card.setAttribute('aria-selected', selected ? 'true' : 'false');
        card.dataset.selected = selected ? 'true' : 'false';
      }
      card.classList.toggle('selected', selected);
    }
    this.options.onSelectionChange?.(this.selected);
  }

  private attachPointer(card: HTMLElement, pin: Pin | FeedPin): void {
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let longPress: number | null = null;

    const cancelLongPress = (): void => {
      if (longPress !== null) {
        window.clearTimeout(longPress);
        longPress = null;
      }
    };

    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      if (event.pointerType === 'touch') {
        longPress = window.setTimeout(() => {
          longPress = null;
          start = null;
          this.options.onSave?.(pin as Pin, card);
        }, 500);
      }
    });

    card.addEventListener('pointermove', (event) => {
      if (!start) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance <= 10) return;
      cancelLongPress();
      if (
        !dragging &&
        this.options.reorderable &&
        this.options.container &&
        event.pointerType !== 'touch'
      ) {
        dragging = true;
        beginDrag(this, pin as Pin, card, event);
      }
      start = null;
    });

    card.addEventListener('pointerup', () => {
      cancelLongPress();
      start = null;
      dragging = false;
    });
    card.addEventListener('pointercancel', () => {
      cancelLongPress();
      start = null;
      dragging = false;
    });
  }

  dropTarget(x: number, y: number): { position: number; container: GridContainer } | null {
    if (!this.options.container) return null;
    const node = document.elementFromPoint(x, y);
    const card = node instanceof Element ? node.closest('article.card') : null;
    if (card instanceof HTMLElement && this.element.contains(card)) {
      const id = Number(card.dataset.pinId);
      const index = this.pins.findIndex((pin) => pin.id === id);
      if (index >= 0) return { position: index + 1, container: this.options.container };
    }
    const rect = this.element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top - 24 && y <= rect.bottom + 24) {
      return { position: 1, container: this.options.container };
    }
    return null;
  }

  get reorder(): GridOptions['onReorder'] {
    return this.options.onReorder;
  }
}

function beginDrag(grid: PinGrid, pin: Pin, card: HTMLElement, event: PointerEvent): void {
  const ghost = card.cloneNode(true) as HTMLElement;
  const rect = card.getBoundingClientRect();
  ghost.classList.add('ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.transform = 'none';
  ghost.style.pointerEvents = 'none';
  document.body.append(ghost);
  card.classList.add('dragging');
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;

  const move = (moveEvent: PointerEvent): void => {
    ghost.style.left = `${moveEvent.clientX - offsetX}px`;
    ghost.style.top = `${moveEvent.clientY - offsetY}px`;
  };

  const finish = (upEvent: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    ghost.remove();
    card.classList.remove('dragging');
    for (const candidate of gridsInDocument()) {
      const target = candidate.dropTarget(upEvent.clientX, upEvent.clientY);
      if (target) {
        const handler = candidate.reorder ?? grid.reorder;
        handler?.(pin, target.container, target.position);
        return;
      }
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
}

let pendingLayout = false;

window.addEventListener('resize', () => {
  if (pendingLayout) return;
  pendingLayout = true;
  window.requestAnimationFrame(() => {
    pendingLayout = false;
    layoutAllGrids();
  });
});

export function cardImage(card: HTMLElement): HTMLImageElement | null {
  return card.querySelector('img');
}

export function dimOtherCards(except: HTMLElement | null, dim: boolean): void {
  for (const grid of gridsInDocument()) {
    for (const card of grid.element.querySelectorAll<HTMLElement>('article.card')) {
      if (card === except) continue;
      card.classList.toggle('dimmed', dim && !reducedMotion());
    }
  }
}
