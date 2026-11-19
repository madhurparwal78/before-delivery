/** Cockpit home: snapshot cards, actions, and the live transaction feed. */
import { Unreachable, SignedOut } from "../shared/api.js";
import { h, ICONS, query, svg } from "../shared/dom.js";
import { refreshFailed } from "../shared/outage.js";
import { feedSection, Feed, filterBar, filterQuery, readFilters, showFilters, type FeedFilters } from "./feed.js";
import { keepFresh } from "./refresh.js";
import { loadSnapshot, SnapshotCards, spokenBalances } from "./snapshot.js";
import { loadAccounts } from "./store.js";

export function mountHome(root: HTMLElement): void {
  const grid = h("div", { class: "snapshot-grid", "data-cards": "" });
  SnapshotCards.skeleton(grid);
  const speaks = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const readAloud = h("button", { class: "btn btn-quiet", type: "button", disabled: !speaks }, svg(ICONS.speaker), h("span", {}, "Read balances aloud"));
  const send = h("a", { class: "btn btn-primary", href: "/payments/new" }, "Send payment");
  const actions = h("div", { class: "snapshot-actions" }, readAloud, send);
  const bar = filterBar(true);
  const feedRoot = feedSection();
  root.append(h("section", { class: "snapshot", "aria-label": "Snapshot" }, actions, grid), h("div", { class: "feed-block" }, bar, feedRoot));

  const cards = new SnapshotCards(grid);
  let filters: FeedFilters = { account: null, method: null, direction: null };
  const feed = new Feed(feedRoot, () => filters);
  let loaded = false;

  function normalise(): FeedFilters {
    const parsed = readFilters(location.search, null);
    const wanted = `${location.pathname}${filterQuery(parsed, true)}`;
    if (wanted !== location.pathname + location.search) history.replaceState(null, "", wanted);
    return parsed;
  }

  async function paintSnapshot(): Promise<void> {
    await loadAccounts();
    cards.paint(await loadSnapshot());
  }

  async function firstLoad(): Promise<void> {
    await loadAccounts();
    filters = normalise();
    showFilters(bar, filters);
    await Promise.all([paintSnapshot(), feed.reload(true)]);
    loaded = true;
  }

  const refresher = keepFresh(async () => {
    if (!loaded) {
      await firstLoad();
      return;
    }
    await paintSnapshot();
    await feed.refresh();
  });
  void refresher.run();

  async function applyFilters(next: FeedFilters, push: boolean): Promise<void> {
    filters = next;
    if (push) history.pushState(null, "", `${location.pathname}${filterQuery(next, true)}`);
    try {
      await feed.reload(true);
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (!(error instanceof SignedOut)) throw error;
    }
  }

  bar.addEventListener("change", () => {
    const next: FeedFilters = {
      account: query<HTMLSelectElement>(bar, '[data-filter="account"]').value || null,
      method: query<HTMLSelectElement>(bar, '[data-filter="method"]').value || null,
      direction: (query<HTMLSelectElement>(bar, '[data-filter="direction"]').value || null) as FeedFilters["direction"],
    };
    void applyFilters(next, true);
  });
  window.addEventListener("popstate", () => {
    if (!loaded) return;
    const parsed = readFilters(location.search, null);
    showFilters(bar, parsed);
    void applyFilters(parsed, false);
  });

  readAloud.addEventListener("click", async () => {
    try {
      const snapshot = await loadSnapshot();
      await loadAccounts();
      const utterance = new SpeechSynthesisUtterance(spokenBalances(snapshot));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (!(error instanceof SignedOut)) throw error;
    }
  });
}
