/** The snapshot cards: total cash and one card per account, painted only from server answers. */
import { formatDollars } from "../../shared/money.js";
import { h, query } from "../shared/dom.js";
import { api } from "../shared/api.js";
import { store, type Account } from "./store.js";

interface SnapshotEntry {
  account_id: string;
  balance_cents: number;
  available_cents: number;
  sparkline: number[];
}

interface Snapshot {
  total_cash_cents: number;
  total_available_cents: number;
  per_account: SnapshotEntry[];
}

const WIDTH = 120;
const HEIGHT = 36;
const INSET = 3;

/** A thin line through thirty daily balances; flat when nothing moved. */
function sparklinePoints(values: number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  return values
    .map((value, index) => {
      const x = (index * WIDTH) / (values.length - 1);
      const y = span === 0 ? HEIGHT / 2 : HEIGHT - INSET - ((value - low) * (HEIGHT - 2 * INSET)) / span;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
}

function card(id: string, label: string, withSparkline: boolean): HTMLElement {
  const article = h(
    "article",
    { class: "card enter", "data-card": id },
    h("h2", { class: "card-label" }, label),
    h("p", { class: "card-figure mono", "data-figure": "" }),
    h("p", { class: "card-available", "data-available": "" }),
  );
  if (withSparkline) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    line.setAttribute("class", "sparkline");
    line.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    line.setAttribute("preserveAspectRatio", "none");
    line.setAttribute("aria-hidden", "true");
    line.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    line.append(path);
    article.append(line);
  }
  return article;
}

export class SnapshotCards {
  constructor(private readonly grid: HTMLElement) {}

  /** Paints a server snapshot in place; cards already on screen keep their elements. */
  paint(snapshot: Snapshot): void {
    this.grid.removeAttribute("aria-busy");
    this.grid.querySelectorAll("[data-skeleton]").forEach((element) => element.remove());
    this.fill("total", "Total cash", snapshot.total_cash_cents, snapshot.total_available_cents, null);
    const wanted = new Set(["total", ...snapshot.per_account.map((entry) => entry.account_id)]);
    for (const existing of this.grid.querySelectorAll<HTMLElement>("[data-card]")) if (!wanted.has(existing.dataset.card ?? "")) existing.remove();
    for (const entry of snapshot.per_account) {
      const account: Account | undefined = store.accounts.find((candidate) => candidate.id === entry.account_id);
      this.fill(entry.account_id, account?.name ?? "Account", entry.balance_cents, entry.available_cents, entry.sparkline);
    }
  }

  private fill(id: string, label: string, balance: number, available: number, sparkline: number[] | null): void {
    let element = this.grid.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
    if (!element) {
      element = card(id, label, sparkline !== null);
      this.grid.append(element);
    }
    query(element, ".card-label").textContent = label;
    query(element, "[data-figure]").textContent = formatDollars(balance);
    query(element, "[data-available]").textContent = `Available ${formatDollars(available)}`;
    if (sparkline) query(element, "polyline").setAttribute("points", sparklinePoints(sparkline));
  }

  static skeleton(grid: HTMLElement): void {
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren(...[0, 1].map(() => h("div", { class: "card card-skeleton", "data-skeleton": "" }, h("span", { class: "skeleton-bar" }), h("span", { class: "skeleton-bar wide" }))));
  }
}

export async function loadSnapshot(): Promise<Snapshot> {
  const { data } = await api<Snapshot>("GET", "/api/snapshot");
  return data;
}

/** What "Read balances aloud" says. */
export function spokenBalances(snapshot: Snapshot): string {
  const parts = [`Total cash is ${formatDollars(snapshot.total_cash_cents)}.`];
  for (const entry of snapshot.per_account) {
    const name = store.accounts.find((candidate) => candidate.id === entry.account_id)?.name ?? "Account";
    parts.push(`${name} has ${formatDollars(entry.balance_cents)}.`);
  }
  return parts.join(" ");
}
