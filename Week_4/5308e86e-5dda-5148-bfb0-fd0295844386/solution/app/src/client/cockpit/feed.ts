/** The transaction feed: filters in the address, paging, and refreshes that never lose the user's place. */
import { FEED_MAX_LIMIT, FEED_PAGE, TRANSACTION_METHODS } from "../../shared/rules.js";
import { formatDollars } from "../../shared/money.js";
import { announce } from "../shared/announce.js";
import { api } from "../shared/api.js";
import { clear, h, isPending, pending, query } from "../shared/dom.js";
import { feedDate, initials, methodLabel } from "../shared/format.js";
import { store } from "./store.js";

export interface FeedFilters {
  account: string | null;
  method: string | null;
  direction: "in" | "out" | null;
}

interface Transaction {
  id: string;
  account_id: string;
  direction: "credit" | "debit";
  amount_cents: number;
  method: string;
  counterparty: string;
  memo: string | null;
  created_at: string;
}

interface Page {
  transactions: Transaction[];
  next_cursor: string | null;
}

/** Filters from an address; anything unknown or foreign falls back to its default. `fixedAccount` pins the account on an account page. */
export function readFilters(search: string, fixedAccount: string | null): FeedFilters {
  const params = new URLSearchParams(search);
  const account = params.get("account");
  const method = params.get("method");
  const direction = params.get("direction");
  return {
    account: fixedAccount ?? (account !== null && store.accounts.some((candidate) => candidate.id === account) ? account : null),
    method: method !== null && (TRANSACTION_METHODS as readonly string[]).includes(method) ? method : null,
    direction: direction === "in" || direction === "out" ? direction : null,
  };
}

/** The query string for filters, in the published order, with defaults left out. */
export function filterQuery(filters: FeedFilters, withAccount: boolean): string {
  const params = new URLSearchParams();
  if (withAccount && filters.account) params.set("account", filters.account);
  if (filters.method) params.set("method", filters.method);
  if (filters.direction) params.set("direction", filters.direction);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function apiQuery(filters: FeedFilters, limit: number, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.account) params.set("account_id", filters.account);
  if (filters.method) params.set("method", filters.method);
  if (filters.direction) params.set("direction", filters.direction === "in" ? "credit" : "debit");
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

const AVATAR_TONES = ["cyan", "lime", "indigo", "amber"];

function toneFor(name: string): string {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0) ?? 0;
  return AVATAR_TONES[sum % AVATAR_TONES.length] ?? "cyan";
}

function renderRow(row: Transaction): HTMLLIElement {
  const credit = row.direction === "credit";
  const sign = credit ? "+" : "−";
  return h(
    "li",
    { class: "feed-row enter", "data-transaction": row.id },
    h("span", { class: `avatar-badge tone-${toneFor(row.counterparty)}`, "aria-hidden": "true" }, initials(row.counterparty)),
    h(
      "div",
      { class: "feed-main" },
      h("strong", { class: "feed-name" }, row.counterparty),
      h("span", { class: "chip" }, methodLabel(row.method)),
      h("span", { class: "feed-date" }, feedDate(row.created_at)),
      row.memo ? h("span", { class: "feed-memo" }, row.memo) : null,
    ),
    h(
      "div",
      { class: `feed-amount ${credit ? "money-in" : "money-out"}` },
      h("span", { class: "mono feed-figure" }, `${sign}${formatDollars(row.amount_cents)}`),
      h("span", { class: "feed-direction" }, credit ? "Money in" : "Money out"),
    ),
  );
}

export class Feed {
  private readonly list: HTMLElement;
  private readonly more: HTMLButtonElement;
  private readonly empty: HTMLElement;
  private shown = new Set<string>();
  private order: string[] = [];
  private cursor: string | null = null;
  private epoch = 0;

  constructor(
    root: HTMLElement,
    private readonly filters: () => FeedFilters,
  ) {
    this.list = query(root, "[data-feed]");
    this.more = query<HTMLButtonElement>(root, "[data-more]");
    this.empty = query(root, "[data-feed-empty]");
    this.more.addEventListener("click", () => void this.showMore());
  }

  private count(): number {
    return this.order.length;
  }

  private announceCount(): void {
    announce(`${this.count()} transactions shown`);
  }

  private paint(): void {
    this.more.hidden = this.cursor === null;
    const active = this.filters();
    const filtered = active.account !== null || active.method !== null || active.direction !== null;
    this.empty.hidden = this.count() > 0;
    this.empty.textContent = filtered ? "No transactions match these filters." : "No transactions yet.";
  }

  /** Replaces the feed with the first page of the current filters. */
  async reload(announceResult: boolean): Promise<void> {
    const epoch = ++this.epoch;
    const { data } = await api<Page>("GET", `/api/transactions?${apiQuery(this.filters(), FEED_PAGE, null)}`);
    if (epoch !== this.epoch) return;
    clear(this.list);
    this.shown = new Set(data.transactions.map((row) => row.id));
    this.order = data.transactions.map((row) => row.id);
    this.cursor = data.next_cursor;
    this.list.append(...data.transactions.map(renderRow));
    this.paint();
    if (announceResult) this.announceCount();
  }

  /** Appends the next page after the last row shown. */
  async showMore(): Promise<void> {
    if (isPending(this.more) || this.cursor === null) return;
    const epoch = this.epoch;
    const done = pending(this.more, "Loading…");
    try {
      const { data } = await api<Page>("GET", `/api/transactions?${apiQuery(this.filters(), FEED_PAGE, this.cursor)}`);
      if (epoch !== this.epoch) return;
      const fresh = data.transactions.filter((row) => !this.shown.has(row.id));
      for (const row of fresh) {
        this.shown.add(row.id);
        this.order.push(row.id);
      }
      this.list.append(...fresh.map(renderRow));
      this.cursor = data.next_cursor;
      this.paint();
      this.announceCount();
    } finally {
      done();
    }
  }

  /** Re-reads the span already loaded and adds newer rows at the top; nothing shown is removed, moved or re-announced. */
  async refresh(): Promise<void> {
    if (this.count() === 0) {
      const epoch = this.epoch;
      const { data } = await api<Page>("GET", `/api/transactions?${apiQuery(this.filters(), FEED_PAGE, null)}`);
      if (epoch !== this.epoch) return;
      this.takeNewRows(data.transactions);
      if (this.cursor === null) this.cursor = data.next_cursor;
      this.paint();
      return;
    }
    const epoch = this.epoch;
    const last = this.order[this.order.length - 1];
    const collected: Transaction[] = [];
    let cursor: string | null = null;
    for (;;) {
      const { data }: { data: Page } = await api<Page>("GET", `/api/transactions?${apiQuery(this.filters(), FEED_MAX_LIMIT, cursor)}`);
      if (epoch !== this.epoch) return;
      collected.push(...data.transactions);
      cursor = data.next_cursor;
      if (cursor === null || data.transactions.some((row) => row.id === last)) break;
    }
    this.takeNewRows(collected);
    this.paint();
  }

  /** Rows ahead of the first row already shown are new; they go on top, in feed order. */
  private takeNewRows(rows: Transaction[]): void {
    const firstKnown = rows.findIndex((row) => this.shown.has(row.id));
    const fresh = (firstKnown === -1 ? rows : rows.slice(0, firstKnown)).filter((row) => !this.shown.has(row.id));
    if (fresh.length === 0) return;
    for (const row of fresh) this.shown.add(row.id);
    this.order = [...fresh.map((row) => row.id), ...this.order];
    this.list.prepend(...fresh.map(renderRow));
  }
}

/** The filter bar: selects named as the published controls. */
export function filterBar(withAccount: boolean): HTMLElement {
  const options = (items: Array<[string, string]>) => items.map(([value, label]) => h("option", { value }, label));
  const bar = h("div", { class: "filters", role: "group", "aria-label": "Filter transactions" });
  if (withAccount) bar.append(h("select", { class: "select", "aria-label": "Filter by account", "data-filter": "account" }, h("option", { value: "" }, "All accounts")));
  bar.append(
    h("select", { class: "select", "aria-label": "Filter by method", "data-filter": "method" }, h("option", { value: "" }, "All methods"), ...options(TRANSACTION_METHODS.map((method) => [method, methodLabel(method)]))),
    h("select", { class: "select", "aria-label": "Filter by direction", "data-filter": "direction" }, ...options([["", "In and out"], ["in", "Money in"], ["out", "Money out"]])),
  );
  return bar;
}

/** Reflects filters into the selects. */
export function showFilters(bar: HTMLElement, filters: FeedFilters): void {
  const account = bar.querySelector<HTMLSelectElement>('[data-filter="account"]');
  if (account) {
    if (account.options.length !== store.accounts.length + 1) {
      account.replaceChildren(h("option", { value: "" }, "All accounts"), ...store.accounts.map((candidate) => h("option", { value: candidate.id }, candidate.name)));
    }
    account.value = filters.account ?? "";
  }
  query<HTMLSelectElement>(bar, '[data-filter="method"]').value = filters.method ?? "";
  query<HTMLSelectElement>(bar, '[data-filter="direction"]').value = filters.direction ?? "";
}

export function feedSection(): HTMLElement {
  return h(
    "section",
    { class: "feed-section", "aria-label": "Transactions" },
    h("ul", { class: "feed", "aria-label": "Transaction feed", "data-feed": "" }),
    h("p", { class: "feed-empty", "data-feed-empty": "", hidden: true }),
    h("button", { class: "btn btn-quiet feed-more", type: "button", "aria-label": "Show more transactions", "data-more": "", hidden: true }, "Show more transactions"),
  );
}
