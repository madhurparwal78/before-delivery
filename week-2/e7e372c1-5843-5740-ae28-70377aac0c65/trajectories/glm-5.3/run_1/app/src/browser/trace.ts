// Unspool: opening a tile splits its numeral into operand chips, draws a
// thread from each filed input's chip to its exhibit row, and opens the trace
// panel. One component owns the whole sequence and its reverse.

import { COPY, type Computation, type ComputationInput, FIGURE_LABELS, nyTime, nyHm, nyDate, etWallSeconds, prefersReducedMotion, isDesktopViewport } from "./app.js";

export interface TraceSession {
  figure: string;
  computation: Computation;
  selectedKey: string;
  close(): void;
}

export interface TraceHooks {
  citeHref: (figure: string, step: string) => string;
  showCiteLink: boolean;
  onClose(): void;
  onStep?(step: string): void;
}

const CLOSING_MS = 500;

export class UnspoolTrace {
  private readonly root: HTMLElement;
  private readonly hooks: TraceHooks;
  private session: TraceSession | null = null;
  private panelEl: HTMLElement | null = null;
  private chipsHost: HTMLElement | null = null;
  private threadsHost: SVGElement | null = null;
  private threadPaths = new Map<string, SVGPathElement>();
  private closingTimer: number | null = null;
  private readonly onReflow = () => {
    this.adaptToViewport();
    this.anchorThreads();
  };

  private adaptToViewport(): void {
    if (!this.panelEl) return;
    const mobile = !isDesktopViewport();
    const isSheet = this.panelEl.classList.contains("trace-sheet");
    if (mobile && !isSheet) {
      this.panelEl.classList.remove("trace-panel", "slide-in");
      this.panelEl.classList.add("trace-sheet");
      document.documentElement.style.overflow = "hidden";
    } else if (!mobile && isSheet) {
      this.panelEl.classList.remove("trace-sheet", "sheet-in");
      this.panelEl.classList.add("trace-panel");
      document.documentElement.style.overflow = "";
    }
  }
  private readonly onKeydown = (event: KeyboardEvent) => this.handleKeydown(event);
  private readonly onFocusTrap = (event: FocusEvent) => this.trapFocus(event);
  private downloadRegion: HTMLElement | null = null;
  private inert = false;
  private openerButton: HTMLElement | null = null;
  private chipNodes: HTMLElement[] = [];
  private lastClosedFigure: string | null = null;

  constructor(root: HTMLElement, hooks: TraceHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  isOpen(): boolean {
    return this.session !== null && !this.inert;
  }

  sessionFigure(): string | null {
    return this.session?.figure ?? null;
  }

  sessionComputation(): Computation | null {
    return this.session?.computation ?? null;
  }

  selectedStep(): string | null {
    return this.session?.selectedKey ?? null;
  }

  /** The figure whose trace just closed, for the tile catch-up rule. */
  closedFigure(): string | null {
    return this.lastClosedFigure;
  }

  open(computation: Computation, selectedKey: string | null, opener: HTMLElement | null): void {
    if (this.session && !this.inert) {
      // A new activation replaces the open trace without a closing sequence.
      this.teardown();
    }
    this.cancelClosing();
    this.openerButton = opener;
    const firstKey = selectedKey ?? computation.inputs[0]?.key ?? "";
    this.session = { figure: computation.figure, computation, selectedKey: firstKey, close: () => this.close() };
    this.inert = false;

    const reduced = prefersReducedMotion();
    this.buildChips(reduced);
    this.buildPanel(computation.inputs.length > 0);

    document.addEventListener("keydown", this.onKeydown, true);
    document.addEventListener("focusin", this.onFocusTrap, true);
    window.addEventListener("resize", this.onReflow);
    window.addEventListener("scroll", this.onReflow, { passive: true, capture: true });

    if (isDesktopViewport() && !reduced) {
      this.drawThreads(computation);
      requestAnimationFrame(() => this.anchorThreads());
    }

    this.renderSelection();
    const firstButton = this.panelEl?.querySelector<HTMLElement>(".input-button");
    if (firstButton) firstButton.focus();
    else this.panelEl?.focus();
  }

  /** Stepping never moves focus; rapid presses apply in order. */
  select(key: string): void {
    if (!this.session || this.inert || !this.panelEl) return;
    this.session.selectedKey = key;
    this.renderSelection();
    this.hooks.onStep?.(key);
    if (isDesktopViewport() && !prefersReducedMotion()) this.anchorThreads();
  }

  step(delta: number): void {
    if (!this.session) return;
    const inputs = this.session.computation.inputs;
    if (inputs.length === 0) return;
    const index = Math.max(0, inputs.findIndex((input) => input.key === this.session?.selectedKey));
    const next = (((index + delta) % inputs.length) + inputs.length) % inputs.length;
    this.select(inputs[next]?.key ?? "");
  }

  close(): void {
    if (!this.session || this.inert) return;
    this.lastClosedFigure = this.session.figure;
    this.session = null;
    this.inert = true;
    const reduced = prefersReducedMotion();
    if (reduced) {
      this.finishClose();
      return;
    }
    this.panelEl?.classList.remove("slide-in", "sheet-in");
    this.panelEl?.classList.add("slide-out", "sheet-out");
    this.panelEl?.setAttribute("aria-hidden", "true");
    this.closingTimer = window.setTimeout(() => this.finishClose(), CLOSING_MS);
  }

  private finishClose(): void {
    const opener = this.openerButton;
    this.teardown();
    if (opener && document.contains(opener)) opener.focus();
    this.hooks.onClose();
  }

  private teardown(): void {
    document.documentElement.style.overflow = "";
    this.panelEl?.remove();
    this.chipsHost?.remove();
    this.threadsHost?.remove();
    this.panelEl = null;
    this.chipsHost = null;
    this.threadsHost = null;
    this.threadPaths.clear();
    this.chipNodes = [];
    this.session = null;
    this.inert = false;
    this.downloadRegion = null;
    document.removeEventListener("keydown", this.onKeydown, true);
    document.removeEventListener("focusin", this.onFocusTrap, true);
    window.removeEventListener("resize", this.onReflow);
    window.removeEventListener("scroll", this.onReflow, { capture: true });
  }

  private cancelClosing(): void {
    if (this.closingTimer !== null) {
      window.clearTimeout(this.closingTimer);
      this.closingTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // Chips: the operand view beneath the tile.

  private buildChips(reduced: boolean): void {
    const computation = this.session?.computation;
    if (!computation) return;
    const tile = this.root.querySelector<HTMLElement>(`[data-tile="${computation.figure}"]`);
    if (!tile) return;
    tile.querySelector(".tile-chip-zone")?.remove();
    const zone = document.createElement("div");
    zone.className = "tile-chip-zone";
    if (computation.figure === "mnav") {
      const formula = document.createElement("div");
      formula.className = "formula-line";
      formula.textContent = "share price × diluted shares ÷ (ending ETH × ETH price)";
      zone.appendChild(formula);
    }
    const chips = document.createElement("div");
    chips.className = "chips";
    computation.inputs.forEach((input, index) => {
      if (computation.figure !== "mnav" && index > 0) {
        const op = document.createElement("span");
        op.className = "op";
        op.setAttribute("aria-hidden", "true");
        op.textContent = this.operatorFor(computation.figure, index);
        chips.appendChild(op);
      }
      const chip = document.createElement(reduced ? "li" : "button");
      chip.setAttribute("aria-hidden", "true");
      chip.setAttribute("tabindex", "-1");
      chip.dataset.unspoolChip = input.key;
      chip.className = "chip" + (input.sets_as_of ? " sets-as-of" : "");
      chip.innerHTML = "";
      const label = document.createElement("span");
      label.textContent = input.label;
      chip.appendChild(label);
      const value = document.createElement("span");
      value.className = "num";
      value.textContent = input.display;
      chip.appendChild(value);
      if (!reduced) {
        const meta = document.createElement("span");
        meta.className = "chip-meta";
        meta.textContent = this.inputMeta(input);
        chip.appendChild(meta);
        (chip as HTMLButtonElement).addEventListener("click", () => this.select(input.key));
      }
      chips.appendChild(chip);
      this.chipNodes.push(chip);
    });
    zone.appendChild(chips);
    tile.appendChild(zone);
    this.chipsHost = zone;
  }

  private operatorFor(figure: string, index: number): string {
    if (figure === "eth-held") return "+";
    if (figure === "eth-per-1000-diluted") return index === 1 ? "÷" : "×";
    return "";
  }

  private inputMeta(input: ComputationInput): string {
    const time = nyTime(input.as_of);
    const badge = clockBadge(input.clock);
    if (input.source.kind === "tick") {
      return `${badge} · ${COPY.lastTick(time)}`;
    }
    const sets = input.sets_as_of ? ` · ${COPY.setsAsOf}` : "";
    return `${badge} · as of ${time} ET${sets}`;
  }

  // ------------------------------------------------------------------
  // The trace panel.

  private buildPanel(hasFiled: boolean): void {
    const computation = this.session?.computation;
    if (!computation) return;
    const mobile = !isDesktopViewport();
    const panel = document.createElement("div");
    panel.className = mobile ? "trace-sheet sheet-in" : "trace-panel slide-in";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", `Trace: ${FIGURE_LABELS[computation.figure] ?? computation.figure}`);
    panel.setAttribute("data-trace-panel", computation.figure);
    if (mobile) panel.setAttribute("data-scroll-lock", "1");

    const head = document.createElement("div");
    head.className = "trace-head";
    const title = document.createElement("h2");
    title.textContent = FIGURE_LABELS[computation.figure] ?? computation.figure;
    head.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.setAttribute("aria-label", "Close trace");
    closeBtn.addEventListener("click", () => this.close());
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const list = document.createElement("ul");
    list.className = "input-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Inputs");
    computation.inputs.forEach((input) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "input-button" + (input.sets_as_of ? " sets-as-of" : "");
      button.setAttribute("aria-pressed", input.key === this.session?.selectedKey ? "true" : "false");
      button.dataset.inputKey = input.key;
      const top = document.createElement("span");
      top.className = "input-top";
      const label = document.createElement("span");
      label.className = "input-label";
      label.textContent = input.label + (input.sets_as_of ? ` — ${COPY.setsAsOf}` : "");
      top.appendChild(label);
      const value = document.createElement("span");
      value.className = "input-value num";
      value.textContent = input.display;
      top.appendChild(value);
      button.appendChild(top);
      const meta = document.createElement("span");
      meta.className = "input-meta";
      const badge = document.createElement("span");
      badge.textContent = clockBadge(input.clock);
      meta.appendChild(badge);
      const asOf = document.createElement("span");
      asOf.textContent = `as of ${nyTime(input.as_of)} ET`;
      meta.appendChild(asOf);
      if (input.source.kind === "tick") {
        const tick = document.createElement("span");
        tick.textContent = COPY.lastTick(nyTime(input.source.at));
        meta.appendChild(tick);
      }
      button.appendChild(meta);
      button.addEventListener("click", () => this.select(input.key));
      item.appendChild(button);
      list.appendChild(item);
    });
    panel.appendChild(list);

    const detail = document.createElement("p");
    detail.className = "status-line";
    detail.setAttribute("data-selected-detail", "");
    panel.appendChild(detail);

    if (hasFiled) {
      const exhibitSource = computation.inputs.find((input) => input.source.kind === "exhibit")?.source;
      if (exhibitSource && exhibitSource.kind === "exhibit") {
        const provenance = document.createElement("div");
        provenance.className = "trace-provenance";
        provenance.append(`Accession ${exhibitSource.accession}`);
        provenance.append(document.createElement("br"));
        provenance.append(`SHA-256 ${exhibitSource.sha256}`);
        panel.appendChild(provenance);

        const table = document.createElement("table");
        table.className = "ledger exhibit-table";
        table.setAttribute("aria-label", `Exhibit ${exhibitSource.accession} page ${exhibitSource.page}`);
        const tbody = document.createElement("tbody");
        computation.inputs.forEach((input) => {
          if (input.source.kind !== "exhibit") return;
          const tr = document.createElement("tr");
          tr.dataset.exhibitRow = input.source.kind === "exhibit" ? input.source.row : "";
          const rowLabel = document.createElement("td");
          rowLabel.textContent = input.source.row;
          tr.appendChild(rowLabel);
          const rowValue = document.createElement("td");
          rowValue.className = "num";
          rowValue.textContent = input.display;
          tr.appendChild(rowValue);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        panel.appendChild(table);

        const download = document.createElement("div");
        download.className = "trace-actions";
        const link = document.createElement("a");
        link.setAttribute("role", "button");
        link.href = `/api/exhibits/${exhibitSource.sha256}`;
        link.textContent = `Open exhibit ${exhibitSource.accession}`;
        link.setAttribute("download", `${exhibitSource.accession}.pdf`);
        link.addEventListener("click", (event) => this.openExhibit(event, link, exhibitSource.sha256, exhibitSource.accession));
        download.appendChild(link);
        panel.appendChild(download);

        const region = document.createElement("div");
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        region.setAttribute("aria-label", "Exhibit download");
        region.className = "status-line";
        this.downloadRegion = region;
        panel.appendChild(region);
      }
    }

    const actions = document.createElement("div");
    actions.className = "trace-actions";
    if (this.hooks.showCiteLink) {
      const cite = document.createElement("a");
      cite.href = this.hooks.citeHref(computation.figure, this.session?.selectedKey ?? "");
      cite.textContent = COPY.citeThisFigure;
      cite.addEventListener("click", (event) => {
        if (!event.metaKey && !event.ctrlKey) event.preventDefault();
      });
      actions.appendChild(cite);
    }
    const close = document.createElement("button");
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close trace");
    close.addEventListener("click", () => this.close());
    actions.appendChild(close);
    panel.appendChild(actions);

    document.body.appendChild(panel);
    this.panelEl = panel;
    if (mobile) this.lockPageScroll();
  }

  private async openExhibit(event: MouseEvent, link: HTMLElement, sha256: string, accession: string): Promise<void> {
    event.preventDefault();
    this.setDownloadMessage("");
    try {
      const response = await fetch(`/api/exhibits/${sha256}`);
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const temp = document.createElement("a");
        temp.href = url;
        temp.download = `${accession}.pdf`;
        temp.click();
        URL.revokeObjectURL(url);
      } else if (response.status === 503) {
        this.setDownloadMessage(COPY.exhibitVaultDown);
      } else {
        this.setDownloadMessage(COPY.exhibitUnexpected);
      }
    } catch {
      this.setDownloadMessage(COPY.exhibitVaultDown);
    }
    link.focus();
  }

  private setDownloadMessage(message: string): void {
    if (this.downloadRegion) this.downloadRegion.textContent = message;
  }

  private renderSelection(): void {
    if (!this.session || !this.panelEl) return;
    const selected = this.session.selectedKey;
    this.panelEl.querySelectorAll<HTMLElement>(".input-button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.inputKey === selected ? "true" : "false");
    });
    this.panelEl.querySelectorAll<HTMLElement>("tr[data-exhibit-row]").forEach((row) => {
      if (row.dataset.exhibitRow === selected) {
        row.setAttribute("aria-current", "true");
        row.style.background = "rgba(31, 63, 212, 0.08)";
      } else {
        row.removeAttribute("aria-current");
        row.style.background = "";
      }
    });
    this.chipNodes.forEach((chip) => {
      const chipKey = chip.dataset.unspoolChip;
      chip.style.outline = chipKey === selected ? "2px solid var(--accent)" : "";
    });
    const selectedInput = this.session.computation.inputs.find((input) => input.key === selected);
    const detail = this.panelEl.querySelector<HTMLElement>("[data-selected-detail]");
    if (detail) {
      if (selectedInput?.source.kind === "official_close") {
        detail.textContent = COPY.officialCloseLine(selectedInput.source.date, "16:00");
      } else if (selectedInput?.source.kind === "tick") {
        detail.textContent = COPY.lastTick(nyTime(selectedInput.source.at));
      } else {
        detail.textContent = "";
      }
    }
  }

  // ------------------------------------------------------------------
  // Threads: one ultramarine path per filed input.

  private drawThreads(computation: Computation): void {
    this.threadsHost?.remove();
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", "threads-layer");
    layer.setAttribute("data-threads", computation.figure);
    this.threadPaths.clear();
    for (const input of computation.inputs) {
      if (input.source.kind !== "exhibit") continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("data-unspool-thread", input.key);
      path.style.strokeDasharray = "none";
      layer.appendChild(path);
      this.threadPaths.set(input.key, path);
    }
    document.body.appendChild(layer);
    this.threadsHost = layer;
    this.animateThreadDraw();
  }

  private animateThreadDraw(): void {
    // Progressive draw over ~400ms: animate stroke-dashoffset once, then remove
    // the dash entirely so re-anchoring never replays the draw.
    for (const path of this.threadPaths.values()) {
      const length = 600;
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.transition = "stroke-dashoffset 0.4s ease-out";
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = "0";
      });
      window.setTimeout(() => {
        path.style.strokeDasharray = "none";
        path.style.strokeDashoffset = "";
        path.style.transition = "";
      }, 420);
    }
  }

  private anchorThreads(): void {
    if (!this.session || !this.panelEl || !this.threadsHost) return;
    if (!isDesktopViewport() || prefersReducedMotion()) {
      this.threadsHost.remove();
      this.threadsHost = null;
      return;
    }
    for (const [key, path] of this.threadPaths) {
      const chip = this.root.querySelector<HTMLElement>(`[data-unspool-chip="${key}"]`);
      if (!chip) continue;
      const input = this.session.computation.inputs.find((entry) => entry.key === key);
      if (!input || input.source.kind !== "exhibit") continue;
      let targetRow: HTMLElement | null = null;
      for (const candidate of Array.from(this.panelEl.querySelectorAll<HTMLElement>("tr[data-exhibit-row]"))) {
        if (candidate.dataset.exhibitRow === input.source.row) {
          targetRow = candidate;
          break;
        }
      }
      if (targetRow === null) continue;
      const chipBox = chip.getBoundingClientRect();
      const rowBox = targetRow.getBoundingClientRect();
      const startX = chipBox.left + chipBox.width / 2;
      const startY = chipBox.top + chipBox.height / 2;
      const endX = rowBox.left;
      const endY = rowBox.top + rowBox.height / 2;
      const midX = Math.max(startX, rowBox.left) - 24;
      path.setAttribute(
        "d",
        `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Keyboard: wrapping Tab, ], [, Escape.

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.session || this.inert) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === "]") {
      event.preventDefault();
      this.step(1);
      return;
    }
    if (event.key === "[") {
      event.preventDefault();
      this.step(-1);
      return;
    }
    if (event.key === "Tab" && this.panelEl) {
      const focusables = visibleFocusables(this.panelEl);
      if (focusables.length === 0) return;
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private trapFocus(event: FocusEvent): void {
    if (!this.session || this.inert || !this.panelEl) return;
    const target = event.target as HTMLElement | null;
    if (target && this.panelEl.contains(target)) return;
    const focusables = visibleFocusables(this.panelEl);
    if (focusables.length === 0) return;
    (focusables[0] as HTMLElement).focus();
  }

  private lockPageScroll(): void {
    const html = document.documentElement;
    html.style.overflow = "hidden";
  }
}

export function clockBadge(clock: string): string {
  if (clock === "holdings") return "Holdings week";
  if (clock === "equity") return "Equity";
  return "ETH live";
}

function visibleFocusables(host: HTMLElement): HTMLElement[] {
  const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(host.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export { etWallSeconds, nyHm, nyDate };
