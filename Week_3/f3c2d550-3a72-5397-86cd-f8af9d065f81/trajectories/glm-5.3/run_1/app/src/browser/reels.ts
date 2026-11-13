// Reels list and the Reel screen: the stops list, the fader with its scroll
// binding, refetch handling, reorder queue, remove, and contact sheets.

import type { ScreenContext } from "./main.js";
import { api, ApiError, type Reference, type Sheet } from "./api.js";
import type { Unit } from "../shared/domain.js";
import { el, text, buildTile, deckStatus, openDialog, announce, clearAnnouncer, type TileParts, finishSwapAtOnce, faderPullSwap } from "./dom.js";
import { buildFader, type FaderParts } from "./fader.js";
import { COPY, announcer } from "./copy.js";

export class ReelsScreen {
  constructor(private ctx: ScreenContext) {
    const tile = buildTile("Current reference");
    tile.showEmpty(COPY.openingDeck);
    ctx.field.append(tile.figure);
    ctx.main.append(text("h1", "Reels"));
    const list = el("ul", { class: "row-list" });
    ctx.main.append(list);
    const newReel = el("button", { type: "button", class: "primary" });
    newReel.textContent = "New reel";
    newReel.addEventListener("click", () => this.openNewReel(newReel));
    ctx.main.append(newReel);
    void this.load(list);
  }

  private async load(list: HTMLElement): Promise<void> {
    const body = await api.reels();
    list.textContent = "";
    for (const reel of body.reels) {
      const li = el("li", { class: "row" });
      const link = el("a", { href: `/reels/${reel.id}` });
      link.textContent = `${reel.name} (${reel.stop_count})`;
      link.addEventListener("click", (e) => { e.preventDefault(); this.ctx.navigate(`/reels/${reel.id}`); });
      li.append(link);
      list.append(li);
    }
  }

  private openNewReel(opener: HTMLElement): void {
    openDialog((root, close) => {
      root.setAttribute("aria-label", "New reel");
      const label = el("label", { for: "reel-name" });
      label.textContent = "Reel name";
      const input = document.createElement("input");
      input.id = "reel-name";
      input.setAttribute("aria-label", "Reel name");
      const create = el("button", { type: "button", class: "primary" });
      create.textContent = "Create reel";
      create.addEventListener("click", async () => {
        try {
          await api.createReel(input.value.trim());
          deckStatus.set(COPY.reelCreated);
          close();
          this.ctx.navigate("/reels");
        } catch (err) {
          if (err instanceof ApiError && err.status === 422) {
            deckStatus.set(COPY.capture422);
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", "reel-name-error");
            const error = el("p", { class: "field-error", id: "reel-name-error" });
            error.textContent = "Give the reel a name of 1 to 60 characters.";
            root.append(error);
            input.focus();
          } else {
            deckStatus.set(COPY.genericFailure);
          }
        }
      });
      root.append(label, input, create);
      input.focus();
    }, opener);
  }
}

interface StopRow {
  li: HTMLElement;
  referenceId: string;
}

export class ReelScreen {
  private tile: TileParts;
  private fader: FaderParts | null = null;
  private rows: StopRow[] = [];
  private playable: Reference[] = [];
  private reel: { id: string; name: string; version: number } | null = null;
  private index = 0;
  private unit: Unit = "mm";
  private swapTimer: number | null = null;
  private orderQueue: Array<{ from: number; to: number }> = [];
  private pendingVersion: number | null = null;
  private lastAcceptedOrder: string[] = [];
  private sheetsList!: HTMLElement;
  private requestedSheetIds = new Set<string>();

  constructor(private ctx: ScreenContext, private id: string, private initialStop?: number) {
    this.tile = buildTile("Current reference");
    this.tile.showEmpty(COPY.openingDeck);
    ctx.field.append(this.tile.figure);
    ctx.main.append(text("h1", "Reel"));
    clearAnnouncer();
    void this.load(true);
    this.startRefetch();
    this.bindShortcuts();
  }

  private async load(initial: boolean): Promise<Reference | void | null> {
    try {
      const [reel, settings] = await Promise.all([api.reel(this.id), api.settings()]);
      this.unit = settings.unit;
      this.reel = { id: reel.id, name: reel.name, version: reel.version };
      this.playable = reel.stops.filter((s) => s.reference.state === "stored").map((s) => s.reference);
      this.lastAcceptedOrder = reel.stops.map((s) => s.reference.id);

      if (this.playable.length === 0) {
        this.tile.showEmpty(COPY.emptyReel);
        this.ctx.main.querySelector("ul")?.remove();
        return null;
      }

      const previousRef = this.rows.length ? this.currentReference() : null;
      this.renderRows(reel.stops.map((s) => s.reference));

      if (!this.fader) {
        this.fader = buildFader((index) => this.change(index));
        this.fader.input.setAttribute("aria-label", "Reel position");
        this.ctx.field.append(this.fader.root);
      }
      this.fader.setStops(this.playable.length);

      // Stop in the address on first load.
      if (initial && this.initialStop !== undefined) {
        const k = this.initialStop;
        if (k >= 1 && k <= this.playable.length) this.index = k - 1;
        else this.index = 0;
        this.fader.setPosition(this.index, false);
        this.writeStopToAddress();
      } else if (initial) {
        this.index = 0;
        this.fader.setPosition(0, false);
        this.writeStopToAddress();
      } else {
        // Refetch: hold the stop by its reference.
        const stillPlayable = previousRef ? this.playable.findIndex((r) => r.id === previousRef.id) : -1;
        if (previousRef && stillPlayable >= 0) {
          if (stillPlayable !== this.index) {
            this.index = stillPlayable;
            this.fader.setPosition(stillPlayable);
            this.writeStopToAddress();
          }
          // No swap and nothing announced.
        } else {
          const oldIndex = this.index;
          const next = Math.min(oldIndex, this.playable.length - 1);
          this.changeTo(next, true);
        }
      }
      this.showCurrent(false);
      this.scrollToRow(this.index);
      void this.refreshSheets();
      return this.currentReference();
    } catch {
      this.ctx.main.append(text("p", COPY.unknownReference));
      return null;
    }
  }

  private currentReference(): Reference | null {
    return this.playable[this.index] ?? null;
  }

  private showCurrent(animate: boolean): void {
    const ref = this.currentReference();
    if (!ref) return;
    const content = { swatch: ref.swatch, photoUrl: ref.photo.display_url, name: ref.title, sizeLine: ref.size_text[this.unit] };
    if (animate) faderPullSwap(this.tile, null, content, 1);
    else finishSwapAtOnce(this.tile, content);
  }

  private renderRows(refs: Reference[]): void {
    let list = this.ctx.main.querySelector<HTMLElement>("ul[data-stops]");
    if (!list) {
      list = el("ul", { class: "row-list" });
      list.setAttribute("data-stops", "true");
      list.setAttribute("aria-label", "Stops");
      const h2 = text("h2", "Stops");
      this.ctx.main.append(h2, list);
    }
    list.textContent = "";
    this.rows = [];
    let playableIndex = 0;
    refs.forEach((ref, i) => {
      const li = el("li", { class: "row two-col" });
      const main = el("div");
      const position = text("p", String(i + 1), { class: "stop-position" });
      const name = text("p", ref.title);
      const maker = text("p", ref.state === "trashed" ? "In the trash" : (ref.maker ?? ""), { class: "maker-line" });
      const size = text("p", ref.state === "trashed" ? "" : ref.size_text[this.unit], { class: "size-line" });
      main.append(position, name, maker, size);
      const controls = el("div", { class: "stop-controls" });
      const up = el("button", { type: "button", class: "icon-btn" });
      up.setAttribute("aria-label", `Move ${ref.title} up`);
      up.innerHTML = UP_ICON;
      up.addEventListener("click", () => this.move(i, -1, up));
      const down = el("button", { type: "button", class: "icon-btn" });
      down.setAttribute("aria-label", `Move ${ref.title} down`);
      down.innerHTML = DOWN_ICON;
      down.addEventListener("click", () => this.move(i, 1, down));
      const remove = el("button", { type: "button", class: "icon-btn" });
      remove.setAttribute("aria-label", `Remove ${ref.title} from reel`);
      remove.innerHTML = CROSS_ICON;
      remove.addEventListener("click", () => void this.removeAt(i, remove));
      controls.append(up, down, remove);
      li.append(main, controls);
      // A pointer can drag a stop row by its whole row to a new position.
      this.bindRowDrag(li, i);
      list.append(li);
      this.rows.push({ li, referenceId: ref.id });
      if (ref.state === "stored") playableIndex++;
    });
    if (!this.sheetsList) {
      const h2 = text("h2", "Contact sheets");
      this.sheetsList = el("ul", { class: "sheets-list" });
      this.sheetsList.setAttribute("aria-label", "Contact sheets");
      const printButton = el("button", { type: "button", class: "primary" });
      printButton.textContent = "Print contact sheet";
      printButton.id = "print-contact-sheet";
      printButton.addEventListener("click", () => this.openPrintDialog(printButton));
      this.ctx.main.append(h2, printButton, this.sheetsList);
    }
  }

  private scrollToRow(index: number): void {
    const playableRow = this.rowsForPlayable()[index];
    if (!playableRow) return;
    const scroller = this.ctx.textCol;
    const top = playableRow.offsetTop - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }

  private rowsForPlayable(): HTMLElement[] {
    const result: HTMLElement[] = [];
    let seen = 0;
    for (const row of this.rows) {
      if (this.isPlayable(row.referenceId)) {
        result.push(row.li);
        seen++;
      }
    }
    return result;
  }

  private isPlayable(referenceId: string): boolean {
    return this.playable.some((r) => r.id === referenceId);
  }

  private change(index: number): void {
    this.changeTo(index, true);
  }

  private changeTo(index: number, announceIt: boolean): void {
    if (index === this.index) return;
    if (this.swapTimer !== null) {
      window.clearTimeout(this.swapTimer);
      this.swapTimer = null;
      const running = this.contentFor(this.index);
      if (running) finishSwapAtOnce(this.tile, running);
    }
    const previous = this.index;
    this.index = index;
    this.fader?.setPosition(index);
    this.writeStopToAddress();
    this.scrollToRow(index);
    this.showCurrent(true);
    const stop = this.playable[index];
    if (stop && announceIt) {
      announce(announcer(index + 1, this.playable.length, stop.title, stop.maker, stop.year));
    }
    this.swapTimer = window.setTimeout(() => { this.swapTimer = null; }, 360);
    void previous;
  }

  private contentFor(index: number): { swatch: string; photoUrl: string; name: string; sizeLine: string } | null {
    const ref = this.playable[index];
    if (!ref) return null;
    return { swatch: ref.swatch, photoUrl: ref.photo.display_url, name: ref.title, sizeLine: ref.size_text[this.unit] };
  }

  private writeStopToAddress(): void {
    const url = `/reels/${this.id}?stop=${this.index + 1}`;
    history.replaceState({}, "", url);
  }

  // A move is one reorder; moves made while one is pending are queued in order.
  private move(index: number, delta: -1 | 1, button: HTMLElement): void {
    const order = this.currentOrderIds();
    const target = index + delta;
    if (target < 0 || target >= order.length) {
      // At the end: focus moves to the other move button.
      const other = delta === -1 ? button.parentElement?.children[1] : button.parentElement?.children[0];
      (other as HTMLElement | undefined)?.focus();
      return;
    }
    [order[index], order[target]] = [order[target], order[index]];
    this.applyOrderLocally(order);
    this.orderQueue.push({ from: index, to: target });
    void this.flushQueue(button);
  }

  private currentOrderIds(): string[] {
    return this.rows.map((r) => r.referenceId);
  }

  private applyOrderLocally(order: string[]): void {
    const byId = new Map(this.rows.map((r) => [r.referenceId, r.li]));
    const list = this.ctx.main.querySelector<HTMLElement>("ul[data-stops]")!;
    list.textContent = "";
    const newRows: StopRow[] = [];
    for (const id of order) {
      const li = byId.get(id)!;
      list.append(li);
      newRows.push({ li, referenceId: id });
    }
    this.rows = newRows;
  }

  // A pointer can drag a stop row by its whole row; each drop is one reorder.
  private bindRowDrag(li: HTMLElement, index: number): void {
    let dragging = false;
    let startY = 0;
    li.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button, a")) return;
      dragging = true;
      startY = e.clientY;
      li.setPointerCapture(e.pointerId);
    });
    li.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rowHeight = li.offsetHeight || 1;
      const steps = Math.trunc((e.clientY - startY) / rowHeight);
      if (steps === 0) return;
      const target = Math.min(this.rows.length - 1, Math.max(0, index + steps));
      if (target === index) return;
      startY = e.clientY;
      const up = li.querySelector<HTMLElement>('[aria-label^="Move"]');
      this.move(index, target > index ? 1 : -1, up ?? li);
      index = target;
    });
    li.addEventListener("pointerup", () => { dragging = false; });
    li.addEventListener("pointercancel", () => { dragging = false; });
  }

  // Queued moves are sent in order, each with the version from the previous answer.
  private async flushQueue(button: HTMLElement): Promise<void> {
    if (this.pendingVersion !== null) return; // a move is still pending
    const version = this.reel?.version ?? 1;
    const next = this.orderQueue.shift();
    if (!next) return;
    this.pendingVersion = version;
    const order = this.currentOrderIds();
    try {
      const updated = await api.reorderStops(this.id, version, order);
      this.reel = { id: updated.id, name: updated.name, version: updated.version };
      this.lastAcceptedOrder = updated.stops.map((s) => s.reference.id);
      deckStatus.set(COPY.movedToStop(updated.stops[next.to]?.reference.title ?? "", next.to + 1));
      button.focus();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reel_version_conflict") {
        deckStatus.set(COPY.reelConflict);
      } else {
        deckStatus.set(COPY.genericFailure);
      }
      this.orderQueue = [];
      this.applyOrderLocally(this.lastAcceptedOrder);
    } finally {
      this.pendingVersion = null;
    }
    // The next queued move, if any, now carries the freshly answered version.
    if (this.orderQueue.length > 0) void this.flushQueue(button);
  }

  private async removeAt(index: number, button: HTMLElement): Promise<void> {
    const order = this.currentOrderIds();
    const removedId = order[index];
    const removedTitle = this.rows[index] ? this.rowTitle(this.rows[index].li) : "";
    const newOrder = order.filter((id) => id !== removedId);
    try {
      const version = this.reel?.version ?? 1;
      const updated = await api.reorderStops(this.id, version, newOrder);
      this.reel = { id: updated.id, name: updated.name, version: updated.version };
      this.lastAcceptedOrder = updated.stops.map((s) => s.reference.id);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const removed = this.rows[index]?.li;
        if (removed) {
          removed.classList.add("row-out");
          await new Promise((r) => window.setTimeout(r, 200));
        }
      }
      deckStatus.set(COPY.removedStop(removedTitle));
      await this.load(false);
      const nextRow = this.rows[index] ?? this.rows[index - 1];
      const nextButton = nextRow?.li.querySelector<HTMLElement>('[aria-label^="Remove"]');
      if (nextButton) nextButton.focus();
      else document.getElementById("print-contact-sheet")?.focus();
    } catch {
      deckStatus.set(COPY.genericFailure);
      button.focus();
    }
  }

  private rowTitle(li: HTMLElement): string {
    return li.querySelector("p:nth-of-type(2)")?.textContent ?? "";
  }

  private bindShortcuts(): void {
    document.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // The shortcuts work whichever control in the field or text column has
    // focus, but never while a text field has focus or a dialog is open.
    if (target?.matches?.("input:not([type='range']), textarea, select")) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.key === "]") { this.change(Math.min(this.playable.length - 1, this.index + 1)); }
    if (e.key === "[") { this.change(Math.max(0, this.index - 1)); }
  };

  private startRefetch(): void {
    window.setInterval(() => void this.load(false), 60_000);
    window.addEventListener("focus", () => void this.load(false));
    // Scroll binding between the text column and the fader.
    let programmatic = false;
    this.ctx.textCol.addEventListener("scroll", () => {
      window.requestAnimationFrame(() => {
        if (programmatic) { programmatic = false; return; }
        const middle = this.ctx.textCol.clientHeight / 2;
        const rows = this.rowsForPlayable();
        let current = 0;
        rows.forEach((li, i) => {
          if (li.offsetTop - this.ctx.textCol.scrollTop <= middle) current = i;
        });
        if (current !== this.index) this.changeTo(current, true);
      });
    });
    const originalScroll = this.scrollToRow.bind(this);
    this.scrollToRow = (index: number) => { programmatic = true; originalScroll(index); };
  }

  private async refreshSheets(): Promise<void> {
    if (!this.sheetsList) return;
    try {
      const body = await api.sheets(this.id);
      this.sheetsList.textContent = "";
      for (const sheet of body.sheets) {
        const li = el("li", { class: "sheet-item" });
        const line = text("p", `${sheet.requested_at} · ${sheet.paper === "a4" ? "A4" : "US Letter"} · ${sheet.unit}`);
        const state = text("p", sheet.state.charAt(0).toUpperCase() + sheet.state.slice(1), { class: "sheet-state" });
        li.append(line, state);
        if (sheet.state === "ready") {
          const link = el("a", { href: `/api/sheets/${sheet.id}/pdf` });
          link.textContent = "Download PDF";
          link.addEventListener("click", (e) => { e.preventDefault(); window.open(`/api/sheets/${sheet.id}/pdf`, "_blank"); });
          li.append(link);
        } else if (sheet.state === "failed") {
          const retry = el("button", { type: "button" });
          retry.textContent = "Try again";
          retry.addEventListener("click", async () => {
            try {
              await api.retrySheet(sheet.id);
              deckStatus.set(COPY.sheetQueued);
            } catch { deckStatus.set(COPY.genericFailure); }
            void this.refreshSheets();
          });
          li.append(retry);
        } else if (sheet.state === "queued" || sheet.state === "rendering") {
          if (this.requestedSheetIds.has(sheet.id)) {
            window.setTimeout(() => void this.watchSheet(sheet.id), 5000);
          }
        }
        this.sheetsList.append(li);
      }
    } catch { /* the next refetch retries */ }
  }

  private async watchSheet(sheetId: string): Promise<void> {
    try {
      const sheet = await api.sheets(this.id).then((s) => s.sheets.find((x) => x.id === sheetId));
      if (!sheet) return;
      if (sheet.state === "ready") {
        deckStatus.set(COPY.sheetReady);
        void this.refreshSheets();
        return;
      }
      if (sheet.state === "failed") {
        deckStatus.set(COPY.sheetFailed);
        void this.refreshSheets();
        return;
      }
      if (this.requestedSheetIds.has(sheetId)) {
        window.setTimeout(() => void this.watchSheet(sheetId), 2000);
      }
    } catch { /* the next poll retries */ }
  }

  private openPrintDialog(opener: HTMLElement): void {
    let paper: "a4" | "letter" = "a4";
    let unit: Unit = this.unit;
    openDialog((root, close) => {
      root.setAttribute("aria-label", "Print contact sheet");
      const paperGroup = el("fieldset");
      paperGroup.setAttribute("role", "radiogroup");
      paperGroup.setAttribute("aria-label", "Paper");
      const paperLegend = el("legend");
      paperLegend.textContent = "Paper";
      paperGroup.append(paperLegend);
      for (const value of ["a4", "letter"] as const) {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "paper";
        radio.value = value;
        radio.setAttribute("aria-label", value === "a4" ? "A4" : "US Letter");
        if (value === paper) radio.checked = true;
        radio.addEventListener("change", () => { if (radio.checked) paper = value; });
        paperGroup.append(radio);
      }
      const unitGroup = el("fieldset");
      unitGroup.setAttribute("role", "radiogroup");
      unitGroup.setAttribute("aria-label", "Sheet unit");
      const unitLegend = el("legend");
      unitLegend.textContent = "Sheet unit";
      unitGroup.append(unitLegend);
      for (const value of ["mm", "in"] as Unit[]) {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "sheet-unit";
        radio.value = value;
        radio.setAttribute("aria-label", value);
        if (value === unit) radio.checked = true;
        radio.addEventListener("change", () => { if (radio.checked) unit = value; });
        unitGroup.append(radio);
      }
      const request = el("button", { type: "button", class: "primary" });
      request.textContent = "Request sheet";
      request.addEventListener("click", async () => {
        const key = `sheet-${Date.now()}`;
        try {
          const sheet = await api.requestSheet(this.id, paper, unit, key);
          this.requestedSheetIds.add(sheet.id);
          deckStatus.set(COPY.sheetQueued);
          close();
          window.setTimeout(() => void this.watchSheet(sheet.id), 2000);
        } catch (err) {
          if (err instanceof ApiError && err.code === "reel_empty") {
            deckStatus.set(COPY.reelEmpty);
          } else {
            deckStatus.set(COPY.genericFailure);
          }
        }
      });
      root.append(paperGroup, unitGroup, request);
    }, opener);
  }
}

const UP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const DOWN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>`;
const CROSS_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
