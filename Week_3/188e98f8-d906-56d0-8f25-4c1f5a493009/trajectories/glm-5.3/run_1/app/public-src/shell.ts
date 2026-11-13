import { COPY } from "./copy";
import { LIMITS, STATUS_LABEL, countText, formatCountdown, type Dispute, type Round } from "./util";

export interface DeskState {
  readonly role: "none" | "quizmaster" | "marker" | "captain";
  readonly teamId: number | null;
  readonly teamName: string | null;
  readonly rounds: readonly Round[];
  readonly table: import("./util").LeagueTable | null;
  readonly disputes: readonly Dispute[];
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | null> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null) continue;
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(): Document {
  return document;
}

/** The one 6-second Desk messages lifetime: a newer message replaces the one showing and restarts it. */
export class DeskMessages {
  private timer: number | undefined;
  private readonly node: HTMLElement;

  constructor(parent: HTMLElement) {
    const region = el("div", {
      role: "status",
      "aria-live": "polite",
      "aria-label": "Desk messages",
      id: "desk-messages",
      class: "desk-messages",
    });
    parent.appendChild(region);
    this.node = region;
  }

  show(text: string, pending = false): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.node.textContent = text;
    if (!pending) {
      this.timer = window.setTimeout(() => {
        this.node.textContent = "";
        this.timer = undefined;
      }, 6000);
    }
  }

  clearPending(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export class TableNews {
  private readonly node: HTMLElement;

  constructor(parent: HTMLElement) {
    const region = el("div", {
      role: "status",
      "aria-live": "polite",
      "aria-label": "Table news",
      id: "table-news",
      class: "table-news",
    });
    parent.appendChild(region);
    this.node = region;
  }

  announce(text: string): void {
    this.node.textContent = text;
  }
}

export function renderRoundStrip(container: HTMLElement, rounds: readonly Round[]): void {
  const strip = container.querySelector<HTMLElement>("#round-strip");
  if (strip === null) return;
  strip.textContent = "";
  for (const round of rounds) {
    const chip = el("li", {
      role: "listitem",
      class: "chip",
      "data-status": round.status,
      "data-round": String(round.number),
    });
    const roundSpan = el("span", { class: "chip-round num" }, `Round ${round.number}`);
    const statusSpan = el("span", {}, `· ${STATUS_LABEL[round.status]}`);
    chip.appendChild(roundSpan);
    chip.appendChild(statusSpan);
    strip.appendChild(chip);
  }
  if (window.innerWidth < 600) {
    strip.classList.add("two-rows");
  } else {
    strip.classList.remove("two-rows");
  }
}

export function renderTileGrid(
  container: HTMLElement,
  table: import("./util").LeagueTable,
  tableNews: TableNews,
  announce: string | undefined,
): void {
  const grid = container.querySelector<HTMLElement>("#tile-grid");
  if (grid === null) return;
  grid.textContent = "";
  for (const team of table.teams) {
    const item = el("li", { class: "tile", "data-position": String(team.position), "data-team-id": String(team.team_id) });
    const article = el("article", { tabindex: "0", "aria-label": team.name });
    const heading = el("h3", {}, team.name);
    const meta = el("div", { class: "tile-meta" });
    meta.appendChild(el("span", { class: "tile-position num" }, String(team.position)));
    meta.appendChild(el("span", { class: "tile-total num" }, `${team.total} pts`));
    if (team.last_round !== null) {
      meta.appendChild(el("span", { class: "tile-round num" }, `Round ${team.last_round.round}: ${team.last_round.score}`));
    }
    article.appendChild(heading);
    article.appendChild(meta);
    item.appendChild(article);
    grid.appendChild(item);
  }
  if (announce !== undefined) {
    tableNews.announce(announce);
  }
}

export function renderTileContainer(container: HTMLElement): HTMLElement {
  const grid = el("ul", { id: "tile-grid", class: "tile-grid", role: "list", "aria-label": "League table" });
  const heading = el("h2", {}, "League table");
  container.appendChild(heading);
  container.appendChild(grid);
  return grid;
}

export function counterText(text: string, limit: number): string {
  return `${countText(text)}/${limit}`;
}

export function fieldCounter(input: HTMLInputElement | HTMLTextAreaElement, limit: number): HTMLElement {
  const wrap = el("div", { class: "field" });
  const counter = el("span", { class: "counter num" }, counterText(input.value, limit));
  const error = el("span", { class: "field-error", role: "status" }, "");
  error.style.display = "none";
  const update = (): void => {
    counter.textContent = counterText(input.value, limit);
    const over = countText(input.value) > limit;
    counter.classList.toggle("over", over);
    error.style.display = over ? "block" : "none";
  };
  input.addEventListener("input", update);
  wrap.appendChild(input);
  wrap.appendChild(counter);
  wrap.appendChild(error);
  input.dataset["limit"] = String(limit);
  return wrap;
}

export function countdownText(seconds: number): string {
  return formatCountdown(seconds);
}

export function notFoundScreen(main: HTMLElement): void {
  main.textContent = "";
  const card = el("section", { class: "card" });
  const heading = el("h1", {}, COPY.notFoundHeading);
  const link = el("a", { href: "/" }, COPY.backToTable);
  card.appendChild(heading);
  card.appendChild(link);
  main.appendChild(card);
}

export function limits(): typeof LIMITS {
  return LIMITS;
}
