import { Download } from "lucide";
import { CARS, LAYOUTS, LAYOUT_IDS, type CarClass, type LayoutId } from "../../shared/model";
import { BOARD_SIZE } from "../../shared/rules";
import { get } from "../api";
import { h, icon, prefersReducedMotion } from "../dom";
import { fmtCoins, fmtDelta, fmtSpeed, fmtTime, type Units } from "../format";
import { live } from "../live";
import { navigate, type PageContext } from "../router";
import { me } from "../session";
import { renderShell } from "../shell";
import { tulip } from "../track";
import type { Board, BoardRow, Push } from "../types";

const LOADING = "Loading times…";
const EMPTY = "No verified times on this board yet.";
const MODES = [{ value: "time-trial", label: "Time trial" }, { value: "circuit", label: "Circuit" }, { value: "drift", label: "Drift" }];
const CLASSES: CarClass[] = ["D", "C", "B"];

interface Filters {
  layout: LayoutId;
  mode: string;
  class: CarClass;
  units: Units;
}

function readFilters(url: URL, fallbackUnits: Units): Filters {
  const p = url.searchParams;
  const layout = p.get("layout");
  const mode = p.get("mode");
  const carClass = p.get("class");
  const units = p.get("units");
  return {
    layout: LAYOUT_IDS.includes(layout as LayoutId) ? (layout as LayoutId) : "saltflat-ring",
    mode: MODES.some((m) => m.value === mode) ? (mode as string) : "time-trial",
    class: CLASSES.includes(carClass as CarClass) ? (carClass as CarClass) : "D",
    units: units === "kmh" || units === "mph" ? units : fallbackUnits,
  };
}

const address = (f: Filters) => `/boards?layout=${f.layout}&mode=${f.mode}&class=${f.class}&units=${f.units}`;
const carName = (carId: string) => CARS.find((car) => car.carId === carId)?.name ?? carId;

export async function boardsPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Leaderboards";
  const filters = readFilters(ctx.url, me()!.units);
  if (location.pathname + location.search !== address(filters)) history.replaceState(history.state, "", address(filters));
  const main = renderShell(true, ["Filters", "Board", "You"]);
  const reduced = prefersReducedMotion();

  const select = (id: string, label: string, options: { value: string; label: string }[], chosen: string, onChange: (value: string) => void) => {
    const el = h("select", { id, "aria-label": label },
      ...options.map((option) => h("option", { value: option.value, selected: option.value === chosen }, option.label)));
    el.addEventListener("change", () => onChange(el.value));
    return h("div", { class: "field" }, h("label", { class: "label", for: id }, label), el);
  };

  const body = h("tbody");
  const valueHead = h("th", { scope: "col", class: "fig" });
  const table = h("table", { class: "board-table", "aria-label": "Leaderboard" },
    h("thead", null, h("tr", null,
      h("th", { scope: "col", class: "fig" }, "Rank"), h("th", { scope: "col" }, "Driver"),
      h("th", { scope: "col", class: "col-car" }, "Car"), valueHead, h("th", { scope: "col", class: "fig" }, "Gap"),
      h("th", { scope: "col", class: "fig col-speed" }, "Top speed"), h("th", { scope: "col" }, "Replay"))),
    body);
  const yourTime = h("section", { class: "your-time", "aria-label": "Your time" });

  let rows: BoardRow[] = [];
  let mine: BoardRow | null = null;
  let loading = true;
  let token = 0;
  let queued: BoardRow[] = [];

  const valueText = (row: BoardRow) => (row.unit === "points" ? `${fmtCoins(row.value)} pts` : fmtTime(row.value));

  function rowElement(row: BoardRow, index: number): HTMLTableRowElement {
    const first = rows[0];
    const gap = filters.mode === "drift" || index === 0 || !first ? "" : fmtDelta(row.value - first.value);
    const ghostPath = `/race?layout=${filters.layout}&mode=time-trial&ghost=${row.runId}`;
    return h("tr", { class: row.mine ? "mine" : "", "data-player": row.playerId },
      h("td", { class: "fig" }, String(index + 1)),
      h("td", null, row.mine ? [h("span", { class: "you" }, "You"), " "] : null, row.name),
      h("td", { class: "col-car" }, carName(row.carId)),
      h("td", { class: "fig" }, valueText(row)),
      h("td", { class: "fig" }, gap),
      h("td", { class: "fig col-speed" }, fmtSpeed(row.topSpeedMps, filters.units)),
      h("td", null, h("div", { class: "replay-cell" },
        filters.mode === "time-trial"
          ? h("button", { type: "button", class: "race-ghost", onclick: () => navigate(ghostPath) }, "Race this ghost") : null,
        h("a", { href: `/v1/runs/${row.runId}/replay`, download: `kerbline-${row.runId}.json` }, icon(Download, 16), h("span", { class: "replay-text" }, "Download replay")))));
  }

  function paintYourTime(): void {
    yourTime.replaceChildren(...(mine ? [
      h("span", { class: "label" }, "Your time"),
      h("span", { class: "mono" }, `Rank ${mine.rank}`),
      h("span", { class: "fig" }, valueText(mine)),
    ] : []));
  }

  function paint(arrived: string | null = null): void {
    valueHead.textContent = filters.mode === "drift" ? "Score" : "Time";
    if (loading) {
      body.replaceChildren(h("tr", null, h("td", { colspan: "7" }, LOADING)));
    } else if (rows.length === 0) {
      body.replaceChildren(h("tr", null, h("td", { colspan: "7" }, h("div", { class: "empty-board" }, tulip(Math.PI / 2), EMPTY))));
    } else {
      body.replaceChildren(...rows.map((row, i) => rowElement(row, i)));
      const moved = arrived ? body.querySelector<HTMLElement>(`[data-player="${arrived}"]`) : null;
      if (moved && !reduced) {
        moved.animate([
          { transform: "translateY(-10px)", backgroundColor: "rgb(236, 213, 187)" },
          { transform: "none", backgroundColor: "rgb(250, 245, 230)" },
        ], { duration: 1000, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      }
    }
    paintYourTime();
  }

  // A pushed row replaces the player's row at its new place; ranks and gaps are recomputed in the same paint.
  function applyRow(row: BoardRow): void {
    rows = rows.filter((existing) => existing.playerId !== row.playerId);
    rows.splice(Math.min(row.rank - 1, rows.length), 0, row);
    rows = rows.slice(0, BOARD_SIZE).map((entry, i) => ({ ...entry, rank: i + 1 }));
    if (row.mine) mine = rows.find((entry) => entry.playerId === row.playerId) ?? row;
    paint(row.playerId);
  }

  // Only the board for the newest filters may render.
  async function load(): Promise<void> {
    const mineToken = ++token;
    loading = true;
    queued = [];
    paint();
    const result = await get<Board>(`/v1/boards?layoutId=${filters.layout}&mode=${filters.mode}&class=${filters.class}`, ctx.signal)
      .catch(() => null);
    if (mineToken !== token || !result || result.status !== 200) return;
    rows = result.data.rows;
    mine = result.data.mine;
    loading = false;
    paint();
    for (const row of queued.splice(0)) applyRow(row);
  }

  function change(update: Partial<Filters>): void {
    const refetch = Object.keys(update).some((key) => key !== "units");
    Object.assign(filters, update);
    const next = address(filters);
    if (location.pathname + location.search !== next) history.pushState(null, "", next);
    if (refetch) void load();
    else paint();
  }

  const onPush = (push: Push) => {
    if (push.type !== "board" || push.layoutId !== filters.layout || push.mode !== filters.mode || push.class !== filters.class) return;
    if (loading) queued.push(push.row);
    else applyRow(push.row);
  };

  main.append(
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Verified times only"), h("h1", null, "Leaderboards"))),
    h("div", { class: "filters" },
      select("board-map", "Map", LAYOUT_IDS.map((id) => ({ value: id, label: LAYOUTS[id].name })), filters.layout, (v) => change({ layout: v as LayoutId })),
      select("board-mode", "Mode", MODES, filters.mode, (v) => change({ mode: v })),
      select("board-class", "Class", CLASSES.map((c) => ({ value: c, label: c })), filters.class, (v) => change({ class: v as CarClass })),
      h("div", { class: "field" },
        h("span", { class: "label", id: "board-units-label" }, "Units"),
        h("div", { class: "radio-row", role: "radiogroup", "aria-labelledby": "board-units-label" },
          ...(["kmh", "mph"] as const).map((u) => h("label", { class: "radio-chip" },
            h("input", { type: "radio", name: "board-units", value: u, checked: filters.units === u, "aria-label": u === "kmh" ? "km/h" : "mph",
              onchange: () => change({ units: u }) }),
            h("span", { "aria-hidden": "true" }, u === "kmh" ? "km/h" : "mph")))))),
    table, yourTime);
  const stop = live.listen(onPush);
  ctx.signal.addEventListener("abort", stop);
  await load();
}
