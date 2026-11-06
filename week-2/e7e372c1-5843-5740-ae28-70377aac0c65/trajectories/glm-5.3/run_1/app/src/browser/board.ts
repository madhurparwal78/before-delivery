// The public board: server-decided clocks, stored computations, the weekly
// history, and the Unspool trace. Refreshes every 4 seconds and never
// recomputes anything from the device clock.

import {
  COPY,
  FIGURE_LABELS,
  apiJson,
  etWallSeconds,
  nyHm,
  nyTime,
  nyDate,
  type Board,
  type HistoryRow,
} from "./app.js";
import { UnspoolTrace, clockBadge } from "./trace.js";

const REFRESH_MS = 4_000;

interface ExpandedClocks {
  equity: boolean;
  eth: boolean;
  holdings: boolean;
}

interface BoardHandle {
  refreshNow: () => void;
  trace: UnspoolTrace;
}

function boardController(root: HTMLElement, options: { citation?: { figure: string; date: string } } = {}): BoardHandle {
  let board: Board | null = null;
  let lastEquityOpen: boolean | null = null;
  let refreshFailed = false;
  const expanded: ExpandedClocks = { equity: false, eth: false, holdings: false };

  const updatesRegion = root.querySelector<HTMLElement>("[data-region='board-updates']");
  const cite = options.citation;

  const trace = new UnspoolTrace(root, {
    citeHref: (figure, step) => `/cite/${figure}/${board?.market_date ?? ""}?step=${encodeURIComponent(step)}`,
    showCiteLink: cite === undefined,
    onClose: () => undefined,
    onStep: (step) => {
      if (cite) setStepParam(step);
    },
  });

  function setStepParam(step: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("step", step);
    window.history.replaceState(null, "", url);
  }

  // The tile for a figure is keyed so refreshes update values in place and
  // never rebuild a tile.
  function ensureTile(figure: string): HTMLElement {
    let tile = root.querySelector<HTMLElement>(`[data-tile="${figure}"]`);
    if (tile) return tile;
    tile = document.createElement("button");
    tile.className = "tile";
    tile.dataset.tile = figure;
    tile.setAttribute("aria-label", `Unspool ${FIGURE_LABELS[figure]}`);
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = FIGURE_LABELS[figure] ?? figure;
    tile.appendChild(label);
    const numeral = document.createElement("span");
    numeral.className = "numeral num";
    numeral.dataset.field = "numeral";
    tile.appendChild(numeral);
    const rule = document.createElement("span");
    rule.className = "rule";
    tile.appendChild(rule);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.field = "badge";
    tile.appendChild(badge);
    const asof = document.createElement("span");
    asof.className = "asof";
    asof.dataset.field = "asof";
    tile.appendChild(asof);
    const citation = document.createElement("span");
    citation.className = "citation";
    citation.dataset.field = "citation";
    tile.appendChild(citation);
    tile.addEventListener("click", () => {
      const current = board?.figures.find((entry) => entry.figure === figure);
      if (current) trace.open(current, null, tile);
    });
    const grid = root.querySelector("[data-region='figures']");
    (grid as HTMLElement)?.appendChild(tile);
    return tile;
  }

  function clockItem(clock: "equity" | "eth" | "holdings", name: string): HTMLElement {
    let item = root.querySelector<HTMLElement>(`[data-clock="${clock}"]`);
    if (item) return item;
    item = document.createElement("div");
    item.className = "clock-item";
    item.dataset.clock = clock;
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", name);
    item.appendChild(group);
    const nameEl = document.createElement("div");
    nameEl.className = "clock-name";
    nameEl.textContent = name;
    group.appendChild(nameEl);
    const short = document.createElement("div");
    short.className = "clock-short";
    short.dataset.field = "short";
    group.appendChild(short);
    const line = document.createElement("div");
    line.className = "clock-line";
    line.dataset.field = "line";
    group.appendChild(line);
    const details = document.createElement("button");
    details.className = "clock-details-btn";
    details.setAttribute("aria-expanded", "false");
    details.textContent = `${name} details`;
    details.addEventListener("click", () => {
      const open = details.getAttribute("aria-expanded") === "true";
      details.setAttribute("aria-expanded", open ? "false" : "true");
      expanded[clock] = !open;
      line.hidden = !expanded[clock];
    });
    group.appendChild(details);
    line.hidden = !expanded[clock];
    const rail = root.querySelector("[data-region='clocks']");
    (rail as HTMLElement)?.appendChild(item);
    return item;
  }

  function historyKey(row: HistoryRow): string {
    return row.restatement_id;
  }

  function historyLinkText(row: HistoryRow): string {
    return row.exhibit ? `Exhibit ${row.exhibit.accession}` : "";
  }

  function ensureHistoryRow(row: HistoryRow): HTMLElement {
    const table = root.querySelector<HTMLTableElement>("table[data-history-table]");
    if (!table) throw new Error("missing history table");
    const tbody = table.tBodies[0] ?? table.appendChild(document.createElement("tbody"));
    let tr = tbody.querySelector<HTMLElement>(`tr[data-history="${historyKey(row)}"]`);
    if (tr) return tr;
    tr = document.createElement("tr");
    tr.dataset.history = historyKey(row);
    tr.id = `restatement-${historyKey(row)}`;

    const weekCell = document.createElement("td");
    weekCell.dataset.field = "week";
    tr.appendChild(weekCell);

    for (const key of [
      "beginning_balance",
      "eth_acquired",
      "staking_rewards",
      "ending_balance",
      "cumulative_staking_rewards",
      "diluted_shares",
    ] as const) {
      const cell = document.createElement("td");
      cell.className = "num";
      cell.dataset.field = key;
      tr.appendChild(cell);
    }
    const perThousand = document.createElement("td");
    perThousand.className = "num";
    perThousand.dataset.field = "per-thousand";
    tr.appendChild(perThousand);
    const exhibitCell = document.createElement("td");
    exhibitCell.dataset.field = "exhibit";
    tr.appendChild(exhibitCell);
    const statusCell = document.createElement("td");
    statusCell.dataset.field = "status";
    tr.appendChild(statusCell);
    tbody.appendChild(tr);

    // Mobile card
    const cards = root.querySelector("[data-history-cards]");
    if (cards) {
      const card = document.createElement("div");
      card.className = "history-card";
      card.dataset.history = historyKey(row);
      card.id = `restatement-${historyKey(row)}`;
      for (const [label, key, numeric] of [
        ["Week ending", "week", false],
        ["Beginning balance", "beginning_balance", true],
        ["ETH acquired", "eth_acquired", true],
        ["Staking rewards", "staking_rewards", true],
        ["Ending balance", "ending_balance", true],
        ["Cumulative rewards", "cumulative_staking_rewards", true],
        ["Diluted shares", "diluted_shares", true],
        ["ETH per 1,000 diluted shares", "per-thousand", true],
        ["Exhibit", "exhibit", false],
        ["Status", "status", false],
      ] as const) {
        const pair = document.createElement("div");
        pair.className = "pair";
        const dt = document.createElement("span");
        dt.textContent = label as string;
        pair.appendChild(dt);
        const dd = document.createElement("span");
        dd.dataset.field = key as string;
        if (numeric) dd.className = "num";
        pair.appendChild(dd);
        card.appendChild(pair);
      }
      cards.appendChild(card);
    }
    return tr;
  }

  function setField(host: ParentNode, field: string, text: string): void {
    const el = host.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function applyBoard(next: Board): void {
    const equityOpen = next.clocks.equity.status === "open";

    // Session-close announcement: only on a genuine open→closed transition
    // between two successful responses.
    // The session-close copy is announced once, on a genuine open→closed
    // transition between two successful responses.
    if (lastEquityOpen === true && equityOpen === false) {
      if (updatesRegion) updatesRegion.textContent = COPY.sessionClose(nyDate(next.server_time));
    } else if (lastEquityOpen === false && equityOpen === true) {
      if (updatesRegion) updatesRegion.textContent = "";
    } else if (refreshFailed) {
      if (updatesRegion) updatesRegion.textContent = "";
    }
    lastEquityOpen = equityOpen;
    refreshFailed = false;

    const notices = root.querySelector("[data-region='notices']");
    if (notices) notices.textContent = next.vault === "unavailable" ? COPY.vaultNotice : "";

    // Clocks
    const equity = clockItem("equity", "Equity session");
    setField(equity, "line", equityOpen
      ? COPY.sessionOpen(nyHm(next.clocks.equity.closes_at ?? next.server_time))
      : COPY.marketClosed(next.clocks.equity.official_close?.date ?? ""));
    setField(equity, "short", equityOpen ? COPY.open : COPY.closed);
    const eth = clockItem("eth", "ETH price");
    const ethLine = next.clocks.eth.last_tick
      ? (next.clocks.eth.status === "live"
          ? COPY.ethLive(nyTime(next.clocks.eth.last_tick.at))
          : COPY.ethStale(nyTime(next.clocks.eth.last_tick.at)))
      : COPY.ethStaleNever;
    setField(eth, "line", ethLine);
    setField(eth, "short", next.clocks.eth.status === "live" ? COPY.live : COPY.stale);
    eth.classList.toggle("stale", next.clocks.eth.status === "stale");
    const holdings = clockItem("holdings", "Holdings week");
    const holdingsLine = next.clocks.holdings
      ? COPY.holdings(next.clocks.holdings.week_ending, nyDate(next.clocks.holdings.as_of))
      : "";
    setField(holdings, "line", holdingsLine);
    setField(holdings, "short", next.clocks.holdings ? COPY.weekShort(next.clocks.holdings.week_ending) : "");

    // Figures. The traced tile stays pinned to the computation its trace
    // opened on; the other tiles update in place.
    const pinnedFigure = trace.isOpen() ? trace.sessionFigure() : null;
    for (const computation of next.figures) {
      const tile = ensureTile(computation.figure);
      if (computation.figure === pinnedFigure) continue;
      setField(tile, "numeral", computation.display);
      const asOfInput = computation.inputs.find((input) => input.sets_as_of) ?? computation.inputs[0];
      setField(tile, "badge", asOfInput ? clockBadge(asOfInput.clock) : "");
      setField(tile, "asof", COPY.asOfLine(nyDate(computation.as_of), nyTime(computation.as_of)));
      const exhibitInput = computation.inputs.find((input) => input.source.kind === "exhibit");
      setField(
        tile,
        "citation",
        exhibitInput && exhibitInput.source.kind === "exhibit" ? COPY.citation(exhibitInput.source.accession, exhibitInput.source.page) : "",
      );
    }
    // A figure the server stops reporting stays as last loaded.

    // Weekly history: insert new rows and move superseded rows beneath their
    // superseder, keeping unchanged rows as the same elements.
    const seenRows = new Set<string>();
    const tbody = root.querySelector<HTMLTableElement>("table[data-history-table]")?.tBodies[0];
    const cardsHost = root.querySelector<HTMLElement>("[data-history-cards]");
    for (const row of next.history) {
      seenRows.add(row.restatement_id);
      const tr = ensureHistoryRow(row);
      setField(tr, "week", row.week_ending);
      setField(tr, "beginning_balance", row.beginning_balance ?? "");
      setField(tr, "eth_acquired", row.eth_acquired ?? "");
      setField(tr, "staking_rewards", row.staking_rewards ?? "");
      setField(tr, "ending_balance", row.ending_balance ?? "");
      setField(tr, "cumulative_staking_rewards", row.cumulative_staking_rewards ?? "");
      setField(tr, "diluted_shares", row.diluted_shares ?? "");
      setField(tr, "per-thousand", row.eth_per_1000_diluted?.display ?? "");
      const statusParts: string[] = [];
      if (row.state === "superseded") {
        statusParts.push(COPY.restated);
        if (row.restated) statusParts.push(COPY.restatedLine(row.restated.on, row.restated.reason));
      }
      setField(tr, "status", statusParts.join(" "));
      const trExhibit = tr.querySelector<HTMLElement>("[data-field='exhibit']");
      if (trExhibit) {
        const wantHref = row.exhibit ? `/api/exhibits/${row.exhibit.sha256}` : "";
        const link = trExhibit.querySelector<HTMLAnchorElement>("a");
        if (row.exhibit) {
          if (!link) {
            const anchor = document.createElement("a");
            anchor.dataset.field = "exhibit-link";
            anchor.textContent = historyLinkText(row);
            anchor.href = wantHref;
            anchor.setAttribute("download", `${row.exhibit.accession}.pdf`);
            trExhibit.textContent = "";
            trExhibit.appendChild(anchor);
          }
        } else if (link) {
          link.remove();
        }
      }
      if (row.state === "superseded" && row.restated) {
        const statusCell = tr.querySelector<HTMLElement>("[data-field='status']");
        if (statusCell && !statusCell.querySelector("[data-superseding-link]")) {
          const viewLink = document.createElement("a");
          viewLink.dataset.supersedingLink = "1";
          viewLink.href = `/staff`; // Board visitors cannot see staff pages; the staff history links directly.
          viewLink.textContent = COPY.viewSuperseding;
          viewLink.tabIndex = 0;
          statusCell.appendChild(document.createTextNode(" "));
          statusCell.appendChild(viewLink);
        }
      }
      // Keep mobile card fields in step.
      const card = cardsHost?.querySelector<HTMLElement>(`[data-history="${row.restatement_id}"]`);
      if (card) {
        setField(card, "week", row.week_ending);
        setField(card, "beginning_balance", row.beginning_balance ?? "");
        setField(card, "eth_acquired", row.eth_acquired ?? "");
        setField(card, "staking_rewards", row.staking_rewards ?? "");
        setField(card, "ending_balance", row.ending_balance ?? "");
        setField(card, "cumulative_staking_rewards", row.cumulative_staking_rewards ?? "");
        setField(card, "diluted_shares", row.diluted_shares ?? "");
        setField(card, "per-thousand", row.eth_per_1000_diluted?.display ?? "");
        setField(card, "exhibit", row.exhibit ? row.exhibit.accession : "");
        setField(card, "status", row.state === "superseded" ? COPY.restated : "");
        const cardExhibit = card.querySelector<HTMLElement>("[data-field='exhibit']");
        const cardLink = cardExhibit?.querySelector<HTMLAnchorElement>("a");
        if (cardExhibit && row.exhibit && !cardLink) {
          const anchor = document.createElement("a");
          anchor.textContent = `Exhibit ${row.exhibit.accession}`;
          anchor.href = `/api/exhibits/${row.exhibit.sha256}`;
          cardExhibit.textContent = "";
          cardExhibit.appendChild(anchor);
        }
      }
    }

    // Order rows newest first, superseded directly beneath their superseder.
    if (tbody) {
      const order = next.history.map((row) => row.restatement_id);
      for (const id of order) {
        const tr = tbody.querySelector<HTMLElement>(`tr[data-history="${id}"]`);
        if (tr) tbody.appendChild(tr);
      }
    }
    if (cardsHost) {
      const order = next.history.map((row) => row.restatement_id);
      for (const id of order) {
        const card = cardsHost.querySelector<HTMLElement>(`[data-history="${id}"]`);
        if (card) cardsHost.appendChild(card);
      }
    }

    board = next;
  }

  let fetchSeq = 0;
  async function refresh(): Promise<void> {
    const seq = ++fetchSeq;
    try {
      const next = await apiJson<Board>("GET", "/api/board");
      if (seq !== fetchSeq) return;
      applyBoard(next);
      // Within 5 seconds after the trace closes, the traced tile shows the
      // figure's current computation; the next refresh applies it.
      if (!trace.isOpen()) {
        const closed = trace.closedFigure();
        if (closed) {
          const current = next.figures.find((entry) => entry.figure === closed);
          const tile = root.querySelector<HTMLElement>(`[data-tile="${closed}"]`);
          if (current && tile) {
            setField(tile, "numeral", current.display);
          }
        }
      }
    } catch {
      if (seq !== fetchSeq) return;
      refreshFailed = true;
      if (updatesRegion) updatesRegion.textContent = COPY.refreshFailed;
    }
  }

  function start(): void {
    if (updatesRegion) updatesRegion.textContent = COPY.loading;
    void refresh();
    window.setInterval(() => void refresh(), REFRESH_MS);
  }

  start();
  return {
    refreshNow: () => void refresh(),
    trace,
  };
}

export function mountBoard(
  root: HTMLElement,
  options: { citation?: { figure: string; date: string } } = {},
): { refreshNow: () => void; trace: UnspoolTrace } {
  return boardController(root, options);
}

export { nyTime, etWallSeconds };
