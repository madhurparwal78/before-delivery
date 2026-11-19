import { h, state, announce } from "./core";
import type { PinJson } from "./core";

/**
 * Masonry placement (DP-10), decided in this one place.
 * The column count comes from the window's inner width alone (DP-09):
 * 2 below 600, 3 below 900, 4 below 1200, otherwise 5.
 */
export function columnCount(width: number): number {
  if (width < 600) return 2;
  if (width < 900) return 3;
  if (width < 1200) return 4;
  return 5;
}

export interface CardPlacement {
  order: number;
  col: number;
  row: number;
  top: number;
  height: number;
  span: 1 | 2;
}

export interface Placement {
  columns: number;
  columnWidth: number;
  cards: CardPlacement[];
}

/** A card's height is round(C x h / w) + 64; half rounds up. */
function cardHeight(cardWidth: number, w: number, hh: number): number {
  return Math.floor((cardWidth * hh) / w + 0.5) + 64;
}

export function placeColumns(count: number, columnWidth: number, cards: Array<{ w: number; h: number }>): Placement {
  const gap = 16;
  const placements: CardPlacement[] = [];
  const heights = new Array<number>(count).fill(0);
  const occupied = new Array<number>(count).fill(0); // cards already occupying each column
  const wideAllowed = count >= 3;

  for (let i = 0; i < cards.length; i++) {
    const { w: iw, h: ih } = cards[i]!;
    const isWide = wideAllowed && iw / ih >= 1.5;
    if (isWide) {
      // The adjacent pair of columns whose taller running height is smallest, ties to the leftmost.
      const wideWidth = 2 * columnWidth + gap;
      const H = cardHeight(wideWidth, iw, ih);
      let bestPair = 0;
      let bestHeight = Infinity;
      for (let c = 0; c + 1 < count; c++) {
        const taller = Math.max(heights[c]!, heights[c + 1]!);
        if (taller < bestHeight) { bestHeight = taller; bestPair = c; }
      }
      const top = bestHeight;
      const row = occupied[bestPair]!;
      heights[bestPair] = top + H + gap;
      heights[bestPair + 1] = top + H + gap;
      occupied[bestPair]!++;
      occupied[bestPair + 1]!++;
      placements.push({ order: i, col: bestPair, row, top, height: H, span: 2 });
    } else {
      // The column with the smallest running height, ties to the leftmost.
      let bestCol = 0;
      let bestHeight = Infinity;
      for (let c = 0; c < count; c++) {
        if (heights[c]! < bestHeight) { bestHeight = heights[c]!; bestCol = c; }
      }
      const H = cardHeight(columnWidth, iw, ih);
      const top = bestHeight;
      const row = occupied[bestCol]!;
      heights[bestCol] = top + H + gap;
      occupied[bestCol]!++;
      placements.push({ order: i, col: bestCol, row, top, height: H, span: 1 });
    }
  }
  return { columns: count, columnWidth, cards: placements };
}

/** Places cards for the current window width; G = width - 32, C = floor((G - 16(n-1)) / n). */
export function placeForWindow(windowWidth: number, cards: Array<{ w: number; h: number }>): Placement {
  const n = columnCount(windowWidth);
  const G = windowWidth - 32;
  const C = Math.floor((G - 16 * (n - 1)) / n);
  return placeColumns(n, C, cards);
}

export interface GridCardData {
  pin: PinJson;
  group?: { size: number; owners: string[] };
}

export interface GridOptions {
  label: string;
  editable: boolean;
  showGroup: boolean;
  reorderable?: boolean;
  onOpen: (card: PinCard, opener: HTMLElement) => void;
  onSave?: (pin: PinJson, opener: HTMLElement) => void;
  onSelectChange?: () => void;
  onReorder?: (pinId: number, target: number | null) => void;
}

export class PinCard {
  el: HTMLElement;
  article: HTMLElement;
  img: HTMLImageElement;
  placement!: CardPlacement;
  selected = false;

  constructor(public data: GridCardData, public grid: PinGrid) {
    const pin = data.pin;
    this.article = h("article", {
      class: "card",
      "data-pin-id": String(pin.id),
      "aria-label": `${pin.title}: ${pin.alt}`,
      tabindex: "-1",
    });
    this.img = h("img", {
      class: "card-img",
      src: variantFor(pin),
      alt: "",
      loading: "lazy",
    }) as unknown as HTMLImageElement;
    this.img.addEventListener("error", () => {
      this.img.replaceWith(h("div", { class: "card-img card-img-unavailable", text: "Image unavailable" }));
    });
    const title = h("div", { class: "card-title", text: pin.title });
    const credit = h("div", { class: "card-credit", text: creditLine(data) });
    this.article.append(this.img, title, credit);
    this.el = this.article;
  }

  setPlacement(p: CardPlacement, columnWidth: number): void {
    this.placement = p;
    this.article.dataset.order = String(p.order);
    this.article.dataset.col = String(p.col);
    this.article.dataset.row = String(p.row);
    this.article.dataset.top = String(p.top);
    this.article.dataset.height = String(p.height);
    this.article.dataset.span = String(p.span);
    if (this.grid.showGroup && this.data.group) {
      this.article.dataset.groupSize = String(this.data.group.size);
    }
    this.article.style.width = (p.span === 2 ? 2 * columnWidth + 16 : columnWidth) + "px";
    this.article.style.height = p.height + "px";
    this.article.style.transform = `translate(${p.col * (columnWidth + 16)}px, ${p.top}px)`;
  }

  setSelected(on: boolean): void {
    this.selected = on;
    this.article.classList.toggle("selected", on);
    this.article.setAttribute("aria-selected", on ? "true" : "false");
    this.article.dataset.selected = on ? "true" : "false";
  }
}

export function variantFor(pin: PinJson): string {
  // The browser picks the best variant; grids are sized from the stored ratio.
  const variants = pin.image.variants;
  return variants.length > 0 ? variants[variants.length - 1]!.url : pin.image.original_url;
}

export function creditLine(data: GridCardData): string {
  const pin = data.pin;
  if (data.group && data.group.size > 1) {
    const owners = data.group.owners;
    if (owners.length === 1) return `Saved by ${owners[0]}`;
    if (owners.length === 2) return `Saved by ${owners[0]} and ${owners[1]}`;
    return `Saved by ${owners[0]} and ${owners.length - 1} others`;
  }
  if (pin.saved_from) {
    if (pin.saved_from.removed) return `Saved from ${pin.saved_from.user_name} · Original removed`;
    return `Saved from ${pin.saved_from.user_name}`;
  }
  return pin.owner.name;
}

export class PinGrid {
  feedEl: HTMLElement;
  cards: PinCard[] = [];
  selection = new Set<number>();
  anchorId: number | null = null;
  lastFocused: number | null = null;
  private ro: ResizeObserver;
  private listeners = new Set<() => void>();

  constructor(public container: HTMLElement, public options: GridOptions) {
    this.feedEl = h("div", {
      class: "grid",
      role: "feed",
      "aria-label": options.label,
    });
    this.container.appendChild(this.feedEl);
    this.ro = new ResizeObserver(() => this.reflow());
    this.ro.observe(document.documentElement);
    window.addEventListener("resize", () => this.reflowInFrame());
    this.reflowInFrame();
  }

  get showGroup(): boolean { return this.options.showGroup; }

  private reflowInFrame(): void {
    // Recompute in one animation frame of a resize, no reload (DP-11).
    requestAnimationFrame(() => this.reflow());
  }

  setCards(data: GridCardData[]): void {
    // Preserve DOM nodes for unchanged pins so live updates keep focus.
    const oldByPin = new Map(this.cards.map(c => [c.data.pin.id, c]));
    this.feedEl.textContent = "";
    this.cards = [];
    for (const d of data) {
      const existing = oldByPin.get(d.pin.id);
      if (existing) {
        existing.data = d;
        existing.article.querySelector<HTMLElement>(".card-credit")!.textContent = creditLine(d);
        this.cards.push(existing);
        this.feedEl.appendChild(existing.article);
      } else {
        const card = new PinCard(d, this);
        this.cards.push(card);
        this.feedEl.appendChild(card.article);
      }
    }
    this.wire();
    this.reflow();
  }

  private wire(): void {
    for (const card of this.cards) {
      this.attachCard(card);
    }
  }

  private attached = new WeakSet<HTMLElement>();
  private attachCard(card: PinCard): void {
    if (this.attached.has(card.article)) return;
    this.attached.add(card.article);
    const a = card.article;
    a.addEventListener("click", (e) => {
      if (e.shiftKey && this.options.editable) {
        this.shiftClickSelect(card);
        return;
      }
      // A plain click opens the pin.
      this.options.onOpen(card, a);
    });
    a.addEventListener("keydown", (e) => this.onKey(e, card));
    if (this.options.editable) {
      a.addEventListener("pointerdown", (e) => this.startDrag(e, card));
    }
    // Touch: tap opens; hold 500 ms without moving 10 px opens the save sheet (DP-74).
    let holdTimer: number | undefined;
    let startX = 0;
    let startY = 0;
    let held = false;
    a.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX; startY = t.clientY; held = false;
      holdTimer = window.setTimeout(() => {
        held = true;
        if (this.options.onSave) this.options.onSave(card.data.pin, a);
      }, 500);
    }, { passive: true });
    a.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) {
        window.clearTimeout(holdTimer);
      }
    }, { passive: true });
    const cancelHold = (): void => { window.clearTimeout(holdTimer); };
    a.addEventListener("touchend", cancelHold, { passive: true });
    a.addEventListener("touchcancel", cancelHold, { passive: true });
    if (this.options.onSave) {
      // After the sheet opens, the touch end still produces a synthesised click;
      // swallow it everywhere so it neither opens the pin nor closes the sheet.
      a.addEventListener("click", (e) => {
        if (!held) return;
        held = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }, true);
      document.addEventListener("click", (e) => {
        if (!held) return;
        // The synthesised click after the hold may land on the sheet's overlay.
        e.stopImmediatePropagation();
        e.preventDefault();
        held = false;
      }, true);
    }
  }

  reflow(): void {
    const width = window.innerWidth;
    const placement = placeForWindow(
      width,
      this.cards.map(c => ({ w: c.data.pin.image.width, h: c.data.pin.image.height }))
    );
    this.feedEl.dataset.columns = String(placement.columns);
    this.feedEl.dataset.columnWidth = String(placement.columnWidth);
    this.feedEl.style.height = Math.max(0, ...placement.cards.map(c => c.top + c.height), 0) + "px";
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i]!.setPlacement(placement.cards[i]!, placement.columnWidth);
    }
    this.listeners.forEach(l => l());
  }

  onReflow(listener: () => void): void {
    this.listeners.add(listener);
  }

  cardByPin(pinId: number): PinCard | undefined {
    return this.cards.find(c => c.data.pin.id === pinId);
  }

  cardsInOrder(): PinCard[] {
    return [...this.cards].sort((a, b) => a.placement.order - b.placement.order);
  }

  // ---------- Grid keyboard navigation (DP-12) ----------

  private onKey(e: KeyboardEvent, card: PinCard): void {
    const order = this.cardsInOrder();
    const index = order.indexOf(card);
    const key = e.key;
    // Shift with the arrow keys selects the range before plain movement is considered (DP-38).
    if (this.options.editable && e.shiftKey && (key === "ArrowRight" || key === "ArrowLeft")) {
      e.preventDefault();
      const next = order[index + (key === "ArrowRight" ? 1 : -1)];
      if (next) {
        this.focusCard(next);
        this.selectRange(this.anchorId, next.data.pin.id);
      }
      return;
    }
    if (key === "ArrowRight" || key === "ArrowLeft") {
      e.preventDefault();
      const next = order[index + (key === "ArrowRight" ? 1 : -1)];
      if (next) { this.focusCard(next); this.updateTabOrder(next); }
      return;
    }
    // Alt with Up or Down reorders before plain vertical movement is considered (DP-45).
    if ((key === "ArrowUp" || key === "ArrowDown") && e.altKey && this.options.editable && this.options.reorderable) {
      e.preventDefault();
      this.options.onReorder?.(card.data.pin.id, key === "ArrowUp" ? card.placement.order - 1 : card.placement.order + 1);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      const cols = [card.placement.col, ...(card.placement.span === 2 ? [card.placement.col + 1] : [])];
      let best: PinCard | null = null;
      for (const c of order) {
        const cCols = [c.placement.col, ...(c.placement.span === 2 ? [c.placement.col + 1] : [])];
        if (cCols.some(cc => cols.includes(cc))) {
          if (key === "ArrowDown" && c.placement.top > card.placement.top) {
            if (!best || c.placement.top < best.placement.top) best = c;
          }
          if (key === "ArrowUp" && c.placement.top < card.placement.top) {
            if (!best || c.placement.top > best.placement.top) best = c;
          }
        }
      }
      if (best) { this.focusCard(best); this.updateTabOrder(best); }
      return;
    }
    if (key === "Home" || key === "End") {
      e.preventDefault();
      const target = key === "Home" ? order[0] : order[order.length - 1];
      if (target) { this.focusCard(target); this.updateTabOrder(target); }
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      this.options.onOpen(card, card.article);
      return;
    }
    if (key === "s" || key === "S") {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (this.options.onSave) this.options.onSave(card.data.pin, card.article);
      return;
    }
    if (key === " " && this.options.editable) {
      e.preventDefault();
      this.selection.clear();
      this.selection.add(card.data.pin.id);
      this.anchorId = card.data.pin.id;
      this.paintSelection();
      this.options.onSelectChange?.();
      return;
    }

    if (key === "Escape" && this.options.editable && this.selection.size > 0) {
      this.selection.clear();
      this.anchorId = null;
      this.paintSelection();
      this.options.onSelectChange?.();
      announce("Selection cleared");
      return;
    }
    if (key === "Tab") {
      this.updateTabOrder(card);
      return;
    }
  }

  focusCard(card: PinCard, scrollIntoView = false): void {
    if (scrollIntoView) card.article.scrollIntoView({ block: "nearest" });
    card.article.focus({ preventScroll: true });
    this.lastFocused = card.data.pin.id;
    this.updateTabOrder(card);
  }

  /** One card per grid is in the Tab order (DP-12). */
  updateTabOrder(card: PinCard): void {
    for (const c of this.cards) c.article.tabIndex = -1;
    card.article.tabIndex = 0;
  }

  makeFirstTabbable(): void {
    const order = this.cardsInOrder();
    const target = this.cards.find(c => c.data.pin.id === this.lastFocused) ?? order[0];
    for (const c of this.cards) c.article.tabIndex = -1;
    if (target) target.article.tabIndex = 0;
  }

  private shiftClickSelect(card: PinCard): void {
    if (this.anchorId === null) {
      this.anchorId = card.data.pin.id;
      this.selection.add(card.data.pin.id);
    } else {
      this.selectRange(this.anchorId, card.data.pin.id);
    }
    this.paintSelection();
    this.options.onSelectChange?.();
  }

  private selectRange(fromId: number | null, toId: number): void {
    const order = this.cardsInOrder().map(c => c.data.pin.id);
    const from = fromId === null ? order.indexOf(toId) : order.indexOf(fromId);
    const to = order.indexOf(toId);
    if (from === -1 || to === -1) return;
    this.selection.clear();
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
      this.selection.add(order[i]!);
    }
    this.paintSelection();
    this.options.onSelectChange?.();
  }

  paintSelection(): void {
    for (const c of this.cards) c.setSelected(this.selection.has(c.data.pin.id));
  }

  clearSelection(): void {
    this.selection.clear();
    this.anchorId = null;
    this.paintSelection();
  }

  selectedPins(): PinJson[] {
    return this.cards.filter(c => this.selection.has(c.data.pin.id)).map(c => c.data.pin);
  }

  // ---------- Pointer drag reordering (DP-46) ----------

  private startDrag(e: PointerEvent, card: PinCard): void {
    if (!this.options.reorderable) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let target: PinCard | null = null;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) {
        dragging = true;
        card.article.classList.add("dragging");
      }
      if (dragging) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const article = el?.closest<HTMLElement>(".card");
        target = article ? (this.cards.find(c => c.article === article) ?? null) : null;
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragging) {
        card.article.classList.remove("dragging");
        if (target && target !== card) {
          this.options.onReorder?.(card.data.pin.id, target.placement.order);
        } else if (!target) {
          // Dropped on empty space of the container: position 1.
          this.options.onReorder?.(card.data.pin.id, 0);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

/** Opens a card image into the exhibit view with Lamp-carry (DP-75). */
export function lampCarry(from: HTMLElement, exhibitImg: HTMLElement, dimmed: HTMLElement[], full: boolean): void {
  if (state.motion === "reduced") return;
  const start = from.getBoundingClientRect();
  const end = exhibitImg.getBoundingClientRect();
  const interpolator = (t: number) => ({
    x: start.left + (end.left - start.left) * t,
    y: start.top + (end.top - start.top) * t,
    w: start.width + (end.width - start.width) * t,
    h: start.height + (end.height - start.height) * t,
  });
  const img = exhibitImg as HTMLImageElement;
  const duration = 520;
  const startedAt = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const mid = interpolator(t);
    img.style.position = "fixed";
    img.style.left = mid.x + "px";
    img.style.top = mid.y + "px";
    img.style.width = mid.w + "px";
    img.style.height = mid.h + "px";
    img.style.zIndex = "60";
    if (t < 1) requestAnimationFrame(frame);
    else {
      img.style.position = "";
      img.style.left = "";
      img.style.top = "";
      img.style.width = "";
      img.style.height = "";
      img.style.zIndex = "";
    }
  };
  requestAnimationFrame(frame);
  for (const d of dimmed) d.classList.add("grid-dimmed");
  window.setTimeout(() => {
    for (const d of dimmed) d.classList.remove("grid-dimmed");
  }, full ? 520 : 320);
}
