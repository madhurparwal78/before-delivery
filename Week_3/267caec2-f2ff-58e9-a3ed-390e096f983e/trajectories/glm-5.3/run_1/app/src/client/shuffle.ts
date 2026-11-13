import { marker } from "./ui.js";

export interface RowData {
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  studioName?: string;
}

export interface RowState {
  rank: number;
  score: string | null;
  cut: "above" | "below";
  award?: string | null;
}

export interface ShuffleOptions {
  cutPosition: number;
  cutLabel: string;
  showAwards: boolean;
  showStudio: boolean;
  statusElement: HTMLElement;
}

export function ordinal(n: number): string {
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${n}th`;
  }
  if (lastOne === 1) {
    return `${n}st`;
  }
  if (lastOne === 2) {
    return `${n}nd`;
  }
  if (lastOne === 3) {
    return `${n}rd`;
  }
  return `${n}th`;
}

function statusCellFor(state: RowState, showAwards: boolean): HTMLElement {
  if (showAwards && state.award) {
    const kind = state.award === "winner" ? "winner" : state.award === "finalist" ? "finalist" : "mention";
    return marker(kind, state.award === "winner" ? "Winner" : state.award === "finalist" ? "Finalist" : "Honourable mention");
  }
  return marker(state.cut === "above" ? "above" : "below", state.cut === "above" ? "Above cut" : "Below cut");
}

function buildRow(data: RowData, state: RowState, opts: ShuffleOptions): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "shuffle-row";
  tr.dataset.entryId = data.entryId;
  const rankCell = document.createElement("td");
  rankCell.className = "cell-rank";
  rankCell.textContent = String(state.rank);
  const titleCell = document.createElement("td");
  titleCell.className = "cell-title";
  titleCell.textContent = data.title;
  const sub = document.createElement("span");
  sub.className = "cell-sub";
  sub.style.display = "block";
  sub.textContent = opts.showStudio && data.studioName ? data.studioName : data.categoryName;
  titleCell.append(sub);
  const categoryCell = document.createElement("td");
  categoryCell.textContent = data.categoryName ?? "";
  const scoreCell = document.createElement("td");
  scoreCell.className = "cell-score";
  scoreCell.textContent = state.score ?? "—";
  const statusCell = document.createElement("td");
  statusCell.append(statusCellFor(state, opts.showAwards));
  tr.append(rankCell, titleCell, categoryCell, scoreCell, statusCell);
  return tr;
}

function cutRuleRow(cutLabel: string): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "cut-rule";
  tr.setAttribute("role", "separator");
  tr.setAttribute("aria-label", cutLabel);
  const cell = document.createElement("td");
  cell.colSpan = 5;
  tr.append(cell);
  return tr;
}

/** The settled table in the given order, with the cut rule in place. */
export function renderRows(tbody: HTMLElement, rows: { data: RowData; state: RowState }[], opts: ShuffleOptions): void {
  tbody.textContent = "";
  rows.forEach((row, index) => {
    if (index === opts.cutPosition) {
      tbody.append(cutRuleRow(opts.cutLabel));
    }
    tbody.append(buildRow(row.data, row.state, opts));
  });
  if (rows.length <= opts.cutPosition) {
    tbody.append(cutRuleRow(opts.cutLabel));
  }
}

interface Move {
  entryId: string;
  entryNumber: number;
  from: number;
  to: number;
  crossed: boolean;
  distance: number;
}

function summaryLine(moves: Move[], scoresChanged: number): string {
  if (moves.length === 0) {
    return scoresChanged > 0 ? "Scores updated, no change in order." : "";
  }
  if (moves.length === 1) {
    const move = moves[0];
    return `Entry ${move.entryNumber} moved from ${ordinal(move.from)} to ${ordinal(move.to)}, now ${move.crossed ? "above" : "below"} the cut.`;
  }
  const crossings = moves.filter((m) => m.crossed);
  let named = crossings.length > 0
    ? [...crossings].sort((a, b) => b.distance - a.distance)[0]
    : [...moves].sort((a, b) => b.distance - a.distance || a.to - b.to)[0];
  if (!named) {
    named = moves[0];
  }
  return `Entry ${named.entryNumber} moved from ${ordinal(named.from)} to ${ordinal(named.to)}, now ${named.crossed ? "above" : "below"} the cut. ${moves.length - 1} other entries moved.`;
}

const pendingShuffles = new WeakMap<HTMLElement, Promise<void>>();

/** One shuffle at a time per table: a second update waits until the first settles. */
export function cutShuffle(
  tbody: HTMLElement,
  rows: { data: RowData; start: RowState; end: RowState }[],
  opts: ShuffleOptions,
): Promise<void> {
  const running = pendingShuffles.get(tbody) ?? Promise.resolve();
  const next = running.then(() => runShuffle(tbody, rows, opts));
  pendingShuffles.set(tbody, next);
  return next;
}

async function runShuffle(
  tbody: HTMLElement,
  rows: { data: RowData; start: RowState; end: RowState }[],
  opts: ShuffleOptions,
): Promise<void> {
  const moves: Move[] = [];
  let scoresChanged = 0;
  for (const row of rows) {
    if (row.start.rank !== row.end.rank) {
      moves.push({
        entryId: row.data.entryId,
        entryNumber: row.data.entryNumber,
        from: row.start.rank,
        to: row.end.rank,
        crossed: row.start.cut !== row.end.cut,
        distance: Math.abs(row.start.rank - row.end.rank),
      });
    }
    if (row.start.score !== row.end.score) {
      scoresChanged += 1;
    }
  }
  if (moves.length === 0 && scoresChanged === 0) {
    renderRows(tbody, rows.map((r) => ({ data: r.data, state: r.end })), opts);
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderStatic(tbody, rows, opts);
    return;
  }
  // Rows start in their shortlist order showing their starting scores.
  const ordered = [...rows].sort((a, b) => a.start.rank - b.start.rank);
  renderRows(tbody, ordered.map((r) => ({ data: r.data, state: r.start })), opts);
  // 1. Score roll, 0 to 320 milliseconds, all changed rows together.
  await Promise.all(
    rows
      .filter((row) => row.start.score !== row.end.score)
      .map((row) => rollScore(tbody, row.start.score, row.end.score, row.data.entryId)),
  );
  // 2. Row travel from 320 milliseconds, rows 40 milliseconds apart in new-rank order.
  const movers = [...moves].sort((a, b) => a.to - b.to);
  if (movers.length > 0) {
    await new Promise<void>((resolve) => {
      let pending = movers.length;
      movers.forEach((move, index) => {
        window.setTimeout(() => {
          travelRow(tbody, rows, move, opts, () => {
            pending -= 1;
            if (pending === 0) {
              resolve();
            }
          });
        }, index * 40);
      });
    });
  }
  // 4. Settled order, then the summary line.
  renderRows(tbody, [...rows].sort((a, b) => a.end.rank - b.end.rank).map((r) => ({ data: r.data, state: r.end })), opts);
  announce(opts.statusElement, summaryLine(moves, scoresChanged));
}

async function rollScore(tbody: HTMLElement, from: string | null, to: string | null, entryId: string): Promise<void> {
  const tr = tbody.querySelector<HTMLTableRowElement>(`tr[data-entry-id="${entryId}"]`);
  const cell = tr?.querySelector<HTMLTableCellElement>(".cell-score");
  if (!tr || !cell) {
    return;
  }
  const fromValue = Number(from ?? "0.00");
  const toValue = Number(to ?? "0.00");
  if (fromValue === toValue) {
    cell.textContent = to;
    return;
  }
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 320);
      cell.textContent = (fromValue + (toValue - fromValue) * progress).toFixed(2);
      if (progress >= 1) {
        cell.textContent = to ?? "—";
        resolve();
      } else {
        window.requestAnimationFrame(tick);
      }
    };
    window.requestAnimationFrame(tick);
  });
}

function travelRow(
  tbody: HTMLElement,
  rows: { data: RowData; start: RowState; end: RowState }[],
  move: Move,
  opts: ShuffleOptions,
  done: () => void,
): void {
  const row = rows.find((r) => r.data.entryId === move.entryId);
  const movedRow = tbody.querySelector<HTMLTableRowElement>(`tr[data-entry-id="${move.entryId}"]`);
  const cutRow = tbody.querySelector<HTMLTableRowElement>("tr.cut-rule");
  if (!movedRow || !row) {
    done();
    return;
  }
  const tr = movedRow;
  const before = tr.offsetTop;
  const allRows = [...tbody.querySelectorAll<HTMLTableRowElement>("tr.shuffle-row")];
  const target = allRows[move.to - 1];
  if (!target || target === tr) {
    finish();
    return;
  }
  if (move.to === allRows.length) {
    tbody.append(tr);
  } else {
    tbody.insertBefore(tr, target);
  }
  const delta = before - tr.offsetTop;
  const started = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / 480);
    const eased = 1 - Math.pow(1 - progress, 3);
    const offset = delta * (1 - eased);
    tr.style.transform = `translateY(${offset}px)`;
    // 3. The marker swaps as the row's centre passes the cobalt cut rule.
    if (cutRow) {
      const centre = tr.offsetTop + tr.offsetHeight / 2 + offset;
      const aboveCut = centre < cutRow.offsetTop;
      const targetCut = aboveCut ? "above" : "below";
      const statusCell = tr.querySelector("td:last-child");
      const expectedLabel = targetCut === "above" ? "Above cut" : "Below cut";
      if (statusCell && statusCell.textContent !== expectedLabel) {
        const state = targetCut === row.end.cut ? row.end : row.start;
        statusCell.textContent = "";
        statusCell.append(statusCellFor({ ...state, cut: targetCut }, opts.showAwards));
      }
    }
    if (progress >= 1) {
      finish();
    } else {
      window.requestAnimationFrame(tick);
    }
  };
  function finish(): void {
    tr.style.transform = "";
    done();
  }
  window.requestAnimationFrame(tick);
}

function announce(element: HTMLElement, line: string): void {
  element.textContent = line;
}

/** Reduced motion: new order at once, static up/down delta labels, same summary. */
export function renderStatic(
  tbody: HTMLElement,
  rows: { data: RowData; start: RowState; end: RowState }[],
  opts: ShuffleOptions,
): void {
  const moves: Move[] = rows
    .filter((row) => row.start.rank !== row.end.rank)
    .map((row) => ({
      entryId: row.data.entryId,
      entryNumber: row.data.entryNumber,
      from: row.start.rank,
      to: row.end.rank,
      crossed: row.start.cut !== row.end.cut,
      distance: Math.abs(row.start.rank - row.end.rank),
    }));
  const scoresChanged = rows.filter((row) => row.start.score !== row.end.score).length;
  tbody.textContent = "";
  const ordered = [...rows].sort((a, b) => a.end.rank - b.end.rank);
  ordered.forEach((row, index) => {
    if (index === opts.cutPosition) {
      tbody.append(cutRuleRow(opts.cutLabel));
    }
    const tr = buildRow(row.data, row.end, opts);
    const delta = document.createElement("span");
    delta.className = "delta-label";
    const direction = row.end.rank < row.start.rank ? "up" : "down";
    const places = Math.abs(row.end.rank - row.start.rank);
    delta.innerHTML = direction === "up"
      ? '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
      : '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
    delta.append(`${direction} ${places}`);
    tr.querySelector("td.cell-title")?.append(delta);
    tbody.append(tr);
  });
  if (ordered.length <= opts.cutPosition) {
    tbody.append(cutRuleRow(opts.cutLabel));
  }
  announce(opts.statusElement, summaryLine(moves, scoresChanged));
}
