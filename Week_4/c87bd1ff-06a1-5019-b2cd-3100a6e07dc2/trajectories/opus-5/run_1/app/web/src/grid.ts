import { copy } from "./copy.js";
import { clear, columns, el } from "./dom.js";
import { portrait } from "./portrait.js";
import type { Lot } from "./types.js";

interface Tile {
  lot: Lot;
  link: HTMLAnchorElement;
  caption: HTMLElement;
  base: number;
  at: number;
}

/**
 * CatalogueGrid is the keyboard grid of 2:3 portrait tiles. It is a single
 * Tab stop: the tile that last had focus keeps it, even when a live update
 * reorders the grid.
 */
export class CatalogueGrid {
  private readonly host: HTMLElement;
  private readonly row: HTMLElement;
  private readonly onFocusLot: (lot: Lot) => void;
  private tiles: Tile[] = [];
  private activeID = "";

  constructor(host: HTMLElement, onFocusLot: (lot: Lot) => void) {
    this.host = host;
    this.onFocusLot = onFocusLot;
    this.row = el("div", { role: "row", class: "grid-row" });
    this.host.setAttribute("role", "grid");
    this.host.setAttribute("aria-label", "Catalogue");
    this.host.className = "catalogue-grid";
    this.host.append(this.row);
    this.host.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.setInterval(() => this.repaintCaptions(), 1000);
  }

  /** setLots paints the grid in the order the server gave. */
  setLots(lots: Lot[]): void {
    const focusWasInside = this.host.contains(document.activeElement);
    if (!this.activeID && lots.length > 0) this.activeID = lots[0].id;
    if (!lots.some((lot) => lot.id === this.activeID) && lots.length > 0) {
      this.activeID = lots[0].id;
    }
    clear(this.row);
    this.tiles = lots.map((lot) => this.buildTile(lot));
    this.applyTabStop();
    if (focusWasInside) this.activeTile()?.link.focus();
  }

  private buildTile(lot: Lot): Tile {
    const lotNumber = lot.lot_number ?? 0;
    const caption = el("span", { class: "tile-caption amounts" });
    const link = el("a", {
      class: "tile",
      href: `/lots/${encodeURIComponent(lot.id)}`,
      "aria-label": `Lot ${lotNumber}, ${lot.title}`,
      tabindex: "-1",
    });
    link.append(
      el("span", { class: "tile-art" }, [portrait(lot.portrait, null, "portrait")]),
      caption,
    );
    link.addEventListener("focus", () => {
      this.activeID = lot.id;
      this.applyTabStop();
      this.onFocusLot(lot);
    });
    link.addEventListener("mouseenter", () => this.onFocusLot(lot));
    const cell = el("div", { role: "gridcell", class: "grid-cell" }, [link]);
    this.row.append(cell);
    const tile: Tile = { lot, link, caption, base: lot.remaining_seconds, at: performance.now() };
    this.paintCaption(tile);
    return tile;
  }

  private paintCaption(tile: Tile): void {
    const lotNumber = tile.lot.lot_number ?? 0;
    if (tile.lot.status === "closed_sold") {
      tile.caption.textContent = copy.tileSold(lotNumber, tile.lot.price ?? 0);
      return;
    }
    if (tile.lot.status === "closed_unsold") {
      tile.caption.textContent = copy.tileUnsold(lotNumber);
      return;
    }
    const elapsed = (performance.now() - tile.at) / 1000;
    const remaining = Math.max(0, Math.round(tile.base - elapsed));
    const shown = tile.lot.price ?? tile.lot.opening_bid ?? 0;
    tile.caption.textContent =
      remaining <= 0
        ? `Lot ${lotNumber} · ${copy.closing}`
        : copy.tileOpen(lotNumber, shown, remaining);
  }

  private repaintCaptions(): void {
    for (const tile of this.tiles) this.paintCaption(tile);
  }

  private activeTile(): Tile | undefined {
    return this.tiles.find((tile) => tile.lot.id === this.activeID);
  }

  private applyTabStop(): void {
    for (const tile of this.tiles) {
      tile.link.tabIndex = tile.lot.id === this.activeID ? 0 : -1;
    }
  }

  private move(to: number): void {
    if (this.tiles.length === 0) return;
    const index = Math.max(0, Math.min(this.tiles.length - 1, to));
    this.activeID = this.tiles[index].lot.id;
    this.applyTabStop();
    this.tiles[index].link.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const at = this.tiles.findIndex((tile) => tile.lot.id === this.activeID);
    if (at < 0) return;
    const step = columns();
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        this.move(at + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        this.move(at - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        this.move(at + step);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.move(at - step);
        break;
      case "Home":
        event.preventDefault();
        this.move(0);
        break;
      case "End":
        event.preventDefault();
        this.move(this.tiles.length - 1);
        break;
      default:
        break;
    }
  }
}
