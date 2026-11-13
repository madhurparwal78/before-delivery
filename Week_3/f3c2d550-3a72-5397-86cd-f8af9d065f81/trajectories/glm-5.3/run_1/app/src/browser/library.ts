// Library: the Daily Pull card, search with latest-wins, the colour-family
// filter, the Saved today / Earlier groups and the in-place refetch.

import type { ScreenContext } from "./main.js";
import { api, ApiError, type DailyPullBody, type Reference } from "./api.js";
import { COLOUR_FAMILIES, type Unit } from "../shared/domain.js";
import { el, text, buildTile, deckStatus, reportFailure, type TileParts, finishSwapAtOnce, faderPullSwap } from "./dom.js";
import { COPY, formatDate, announcer } from "./copy.js";

export class LibraryScreen {
  private tile: TileParts;
  private groups = new Map<string, { list: HTMLElement; ids: string[] }>();
  private rows = new Map<string, { row: HTMLElement; link: HTMLAnchorElement }>();
  private current: Reference | null = null;
  private searchBox!: HTMLInputElement;
  private familySelect!: HTMLSelectElement;
  private latestSearchToken = 0;
  private settingsUnit: Unit = "mm";

  constructor(private ctx: ScreenContext) {
    this.tile = buildTile("Current reference");
    ctx.field.append(this.tile.figure);
    ctx.main.append(text("h1", "Library"));
    this.buildDailyPullCard();
    this.buildSearchControls();
    this.buildGroups();
    this.tile.showEmpty(COPY.openingDeck);
    void this.loadSettings();
    void this.fetchReferences();
    this.startRefetch();
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await api.settings();
      this.settingsUnit = settings.unit;
      void this.fetchReferences();
    } catch { /* the next refetch retries */ }
  }

  private buildDailyPullCard(): void {
    const card = el("section", { role: "region", "aria-label": "Daily Pull" });
    const h2 = text("h2", "Daily Pull");
    const pickLine = text("p", "", { class: "daily-pick-line" });
    pickLine.id = "daily-pick-line";
    const pulledFor = text("p", "");
    pulledFor.id = "daily-pulled-for";
    const nextPull = text("p", "");
    nextPull.id = "daily-next-pull";
    card.append(h2, pickLine, pulledFor, nextPull);
    this.ctx.main.append(card);
    void this.refreshPull();
    window.setInterval(() => void this.refreshPull(), 60_000);
    window.addEventListener("focus", () => void this.refreshPull());
  }

  private async refreshPull(): Promise<void> {
    try {
      const pull: DailyPullBody = await api.dailyPull();
      const pickLine = document.getElementById("daily-pick-line")!;
      const pulledFor = document.getElementById("daily-pulled-for")!;
      const nextPull = document.getElementById("daily-next-pull")!;
      pickLine.textContent = "";
      if (pull.state === "picked" && pull.reference) {
        const r = pull.reference;
        let tail = "";
        if (r.maker && r.year !== null) tail = `, ${r.maker} ${r.year}`;
        else if (r.maker) tail = `, ${r.maker}`;
        else if (r.year !== null) tail = `, ${r.year}`;
        const link = el("a", { href: `/references/${r.id}` });
        link.textContent = `${r.title}${tail}`;
        link.addEventListener("click", (e) => { e.preventDefault(); this.ctx.navigate(`/references/${r.id}`); });
        pickLine.append(link);
        pulledFor.textContent = `Pulled for ${formatDate(pull.pull_day)}`;
        nextPull.textContent = `Next pull at 06:00, ${pull.zone}`;
      } else if (pull.state === "empty") {
        pickLine.textContent = COPY.nothingToPull;
        pulledFor.textContent = "";
        nextPull.textContent = "";
      } else {
        pickLine.textContent = COPY.todaysPullRemoved;
        pulledFor.textContent = `Pulled for ${formatDate(pull.pull_day)}`;
        nextPull.textContent = `Next pull at 06:00, ${pull.zone}`;
      }
    } catch { /* the next poll retries */ }
  }

  private buildSearchControls(): void {
    this.searchBox = document.createElement("input");
    this.searchBox.type = "search";
    this.searchBox.setAttribute("aria-label", "Search your deck");
    this.searchBox.placeholder = "Search your deck";
    const familyLabel = el("label", { for: "colour-family" });
    familyLabel.textContent = "Colour family";
    this.familySelect = document.createElement("select");
    this.familySelect.id = "colour-family";
    this.familySelect.setAttribute("aria-label", "Colour family");
    const all = el("option", { value: "" });
    all.textContent = "All colours";
    this.familySelect.append(all);
    for (const family of COLOUR_FAMILIES) {
      const option = el("option", { value: family });
      option.textContent = family;
      this.familySelect.append(option);
    }
    this.ctx.main.append(this.searchBox, familyLabel, this.familySelect);

    let debounce: number | undefined;
    this.searchBox.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void this.runSearch(), 250);
    });
    this.familySelect.addEventListener("change", () => void this.runSearch());
  }

  private buildGroups(): void {
    for (const name of ["Saved today", "Earlier"]) {
      const group = el("section", { class: "list-group" });
      const h2 = text("h2", name);
      const list = el("ul", { class: "row-list" });
      group.append(h2, list);
      this.ctx.main.append(group);
      this.groups.set(name, { list, ids: [] });
    }
  }

  // Library refetch in place: rows are merged, never rebuilt.
  private async fetchReferences(): Promise<void> {
    try {
      const body = await api.references();
      const known = new Set(this.rows.keys());
      for (const [groupName, refs] of [["Saved today", body.saved_today], ["Earlier", body.earlier]] as const) {
        const group = this.groups.get(groupName)!;
        const newIds: string[] = [];
        for (const ref of refs) {
          newIds.push(ref.id);
          if (!known.has(ref.id)) {
            const row = this.buildRow(ref);
            group.list.append(row.row);
            this.rows.set(ref.id, row);
          } else {
            const existing = this.rows.get(ref.id)!;
            existing.link.textContent = `${ref.title} — ${ref.maker ?? ""}`;
            existing.row.querySelector(".size-line")!.textContent = ref.size_text[this.settingsUnit];
          }
        }
        group.ids = newIds;
      }
      // Rows whose reference left are removed; focus moves to a neighbour.
      for (const [id, row] of this.rows) {
        const inAnyGroup = [...this.groups.values()].some((g) => g.ids.includes(id));
        if (!inAnyGroup) {
          const focused = document.activeElement === row.link;
          row.row.remove();
          this.rows.delete(id);
          if (this.current?.id === id) this.tile.showEmpty(COPY.libraryEmpty);
          if (focused) this.focusNeighbour(id);
        }
      }
      if (this.rows.size === 0 && !this.searchBox.value && !this.familySelect.value) {
        this.tile.showEmpty(COPY.libraryEmpty);
      }
    } catch { /* the next refetch retries */ }
  }

  private focusNeighbour(removedId: string): void {
    const ids = [...this.rows.keys()];
    const index = ids.indexOf(removedId);
    const nextId = ids[index + 1] ?? ids[index - 1];
    if (nextId) this.rows.get(nextId)?.link.focus();
    else this.searchBox.focus();
  }

  private buildRow(ref: Reference): { row: HTMLElement; link: HTMLAnchorElement } {
    const li = el("li");
    const link = el("a", { href: `/references/${ref.id}` }) as HTMLAnchorElement;
    link.textContent = ref.title;
    link.setAttribute("aria-label", `${ref.title}, ${ref.maker ?? ""}`);
    const makerLine = text("p", ref.maker ?? "", { class: "maker-line" });
    const sizeLine = text("p", ref.size_text[this.settingsUnit], { class: "size-line" });
    li.append(link, makerLine, sizeLine);

    // Hover or focus loads the reference into the tile with the Fader Pull swap.
    const load = () => {
      if (this.current?.id === ref.id) return;
      const previous = this.current ? this.referenceContent(this.current) : null;
      this.current = ref;
      const content = this.referenceContent(ref);
      faderPullSwap(this.tile, previous, content, 1);
    };
    li.addEventListener("mouseenter", load);
    link.addEventListener("focus", load);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      this.ctx.navigate(`/references/${ref.id}`);
    });
    return { row: li, link };
  }

  private referenceContent(ref: Reference): { swatch: string; photoUrl: string; name: string; sizeLine: string } {
    return { swatch: ref.swatch, photoUrl: ref.photo.display_url, name: ref.title, sizeLine: ref.size_text[this.settingsUnit] };
  }

  private async runSearch(): Promise<void> {
    const q = this.searchBox.value.trim();
    const family = this.familySelect.value;
    if (q.length === 0 && family === "") {
      // Back to the grouped library.
      const searchList = this.ctx.main.querySelector("[data-search-results]");
      searchList?.remove();
      this.groups.forEach((g) => { g.list.style.display = ""; });
      this.ctx.main.querySelectorAll<HTMLElement>(".list-group h2").forEach((h) => { h.style.display = ""; });
      deckStatus.clear();
      void this.fetchReferences();
      return;
    }
    const token = ++this.latestSearchToken;
    try {
      const body = await api.search(q, family || undefined);
      if (token !== this.latestSearchToken) return; // an older answer is discarded
      this.renderResults(body.results);
      if (body.results.length === 0) deckStatus.set(COPY.noReferencesMatch);
      else deckStatus.set(COPY.nReferencesMatch(body.results.length));
    } catch {
      if (token === this.latestSearchToken) deckStatus.set(COPY.genericFailure);
    }
  }

  private renderResults(results: Reference[]): void {
    this.groups.forEach((g) => { g.list.style.display = "none"; });
    this.ctx.main.querySelectorAll<HTMLElement>(".list-group h2").forEach((h) => { h.style.display = "none"; });
    let list = this.ctx.main.querySelector<HTMLElement>("[data-search-results]");
    if (!list) {
      list = el("ul", { class: "row-list" });
      list.setAttribute("data-search-results", "true");
      this.ctx.main.append(list);
    }
    list.textContent = "";
    for (const ref of results) {
      const row = this.buildRow(ref);
      list.append(row.row);
    }
  }

  private startRefetch(): void {
    window.setInterval(() => void this.fetchReferences(), 60_000);
    window.addEventListener("focus", () => void this.fetchReferences());
  }
}
