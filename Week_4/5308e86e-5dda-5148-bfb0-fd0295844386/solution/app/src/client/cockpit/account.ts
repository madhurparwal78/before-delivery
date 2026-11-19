/** One account: balance, available balance, its feed and monthly statements. */
import { formatDollars } from "../../shared/money.js";
import { STATEMENT_MONTHS } from "../../shared/rules.js";
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { h, ICONS, isPending, pending, query, svg } from "../shared/dom.js";
import { statementMonths } from "../shared/format.js";
import { actionSucceeded, refreshFailed } from "../shared/outage.js";
import { feedSection, Feed, filterBar, filterQuery, readFilters, showFilters, type FeedFilters } from "./feed.js";
import { keepFresh } from "./refresh.js";
import { currentMe, loadAccounts, store } from "./store.js";

export function accountIdFromPath(): string {
  return location.pathname.split("/").pop() ?? "";
}

export function mountAccount(root: HTMLElement): void {
  const accountId = accountIdFromPath();
  const title = query(document, "#page-title");
  const balance = h("p", { class: "account-balance mono" });
  const available = h("p", { class: "card-available" });
  const monthSelect = h("select", { class: "select", "aria-label": "Statement month" });
  const download = h("button", { class: "btn btn-quiet", type: "button" }, svg(ICONS.download), h("span", {}, "Download statement"));
  const bar = filterBar(false);
  const feedRoot = feedSection();
  const missing = h("p", { class: "empty-state", hidden: true }, "We couldn't find that account.");
  const summary = h("section", { class: "account-summary", "aria-label": "Balance" }, balance, available);
  const statement = h("div", { class: "statement-controls" }, monthSelect, download);
  root.append(missing, summary, statement, h("div", { class: "feed-block" }, bar, feedRoot));

  let filters: FeedFilters = { account: accountId, method: null, direction: null };
  const feed = new Feed(feedRoot, () => filters);
  let loaded = false;

  function paintAccount(): boolean {
    const account = store.accounts.find((candidate) => candidate.id === accountId);
    if (!account) return false;
    title.textContent = account.name;
    document.title = `${account.name} · Tallwind`;
    balance.textContent = formatDollars(account.balance_cents);
    available.textContent = `Available ${formatDollars(account.available_cents)}`;
    return true;
  }

  function normalise(): FeedFilters {
    const parsed = readFilters(location.search, accountId);
    const wanted = `${location.pathname}${filterQuery(parsed, false)}`;
    if (wanted !== location.pathname + location.search) history.replaceState(null, "", wanted);
    return parsed;
  }

  async function firstLoad(): Promise<void> {
    await loadAccounts();
    if (!paintAccount()) {
      missing.hidden = false;
      summary.hidden = true;
      statement.hidden = true;
      bar.hidden = true;
      feedRoot.hidden = true;
      return;
    }
    const months = statementMonths(currentMe().business_date, STATEMENT_MONTHS);
    monthSelect.replaceChildren(...months.map((month) => h("option", { value: month.value }, month.label)));
    filters = normalise();
    showFilters(bar, filters);
    await feed.reload(true);
    loaded = true;
  }

  const refresher = keepFresh(async () => {
    if (!loaded) {
      await firstLoad();
      return;
    }
    await loadAccounts();
    paintAccount();
    await feed.refresh();
  });
  void refresher.run();

  async function applyFilters(next: FeedFilters, push: boolean): Promise<void> {
    filters = next;
    if (push) history.pushState(null, "", `${location.pathname}${filterQuery(next, false)}`);
    try {
      await feed.reload(true);
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (!(error instanceof SignedOut)) throw error;
    }
  }

  bar.addEventListener("change", () => {
    void applyFilters(
      {
        account: accountId,
        method: query<HTMLSelectElement>(bar, '[data-filter="method"]').value || null,
        direction: (query<HTMLSelectElement>(bar, '[data-filter="direction"]').value || null) as FeedFilters["direction"],
      },
      true,
    );
  });
  window.addEventListener("popstate", () => {
    if (!loaded) return;
    const parsed = readFilters(location.search, accountId);
    showFilters(bar, parsed);
    void applyFilters(parsed, false);
  });

  download.addEventListener("click", async () => {
    if (isPending(download)) return;
    const done = pending(download, "Preparing statement…", query<HTMLElement>(download, "span"));
    try {
      const { data, headers } = await api<string>("GET", `/api/accounts/${accountId}/statement.csv?month=${encodeURIComponent(monthSelect.value)}`, { text: true });
      const name = /filename\*=UTF-8''([^;\s]+)/.exec(headers.get("Content-Disposition") ?? "")?.[1];
      const link = h("a", { href: URL.createObjectURL(new Blob([data], { type: "text/csv" })), download: name ? decodeURIComponent(name) : "statement.csv" });
      document.body.append(link);
      link.click();
      link.remove();
      actionSucceeded();
      announce("Statement downloaded");
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });
}
