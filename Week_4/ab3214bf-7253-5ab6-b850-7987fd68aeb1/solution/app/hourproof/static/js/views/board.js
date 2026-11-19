// The window board: every window as a row, filtered in place from a sheet, the filter held in the address.
import { h, pct, targetWord, link, loadingFigure } from "../dom.js";
import { get } from "../api.js";
import { countdown } from "../clock.js";
import { openDialog } from "../dialog.js";
import { announce } from "../announce.js";
import { poll } from "../poll.js";
import { table, row } from "../table.js";

export const STATES = ["Awaiting meters", "Reconciling", "In review", "Returned", "Cancelling", "Cancelled", "Signed", "Sealed", "Restated"];
const TIMED_OUT = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.";

export function stateFromQuery(query) {
  const value = query.get("state");
  return STATES.includes(value) ? value : "";
}

export function mount({ container, query, navigate }) {
  let windows = [];
  let filter = stateFromQuery(query);
  const timers = [];
  const timerById = new Map();
  const group = { async ask() { await refresh(); } };
  const status = h("div", { role: "status", "aria-label": "Board status", "aria-live": "polite", class: "sr-only" });
  const grid = table("Window board", ["Window", "State", "Month", "Week", "Day", "Hour", "Target", "Review"], "repeat(7, auto) minmax(8rem, 1fr)");
  const empty = h("p", { class: "figure", hidden: true, text: "NO WINDOWS MATCH." });
  const opener = h("button", { type: "button", text: "Filter windows" });
  const loading = loadingFigure();
  grid.el.hidden = true;
  container.replaceChildren(h("section", { class: "page field-yellow" },
    h("h1", { text: "YOUR WINDOWS." }), h("div", { class: "row" }, opener), status, loading, grid.el, empty));

  const shown = () => windows.filter((w) => !filter || w.state === filter);
  const draw = () => {
    for (const t of timers.splice(0)) t.stop();
    timerById.clear();
    const rows = shown();
    grid.body.replaceChildren(...rows.map((w) => {
      const timer = w.state === "In review" && w.review_seconds_left !== null
        ? h("span", { role: "timer", "aria-label": "Review time left" }) : null;
      if (timer) {
        const handle = countdown(timer, w.review_seconds_left, group);
        timers.push(handle);
        timerById.set(w.id, handle);
      }
      return row([
        ["Window", link(`/windows/${w.id}`, `${w.site.name} ${w.month}`)],
        ["State", w.state],
        ["Month", pct(w.scores.month_bp)],
        ["Week", pct(w.scores.week_bp)],
        ["Day", pct(w.scores.day_bp)],
        ["Hour", h("span", { class: "board-score", text: pct(w.scores.hour_bp) })],
        ["Target", targetWord(w)],
        ["Review", [timer, w.state === "Returned" && w.returned_reason === TIMED_OUT ? h("span", { text: TIMED_OUT }) : null]],
      ]);
    }));
    loading.remove();
    empty.hidden = rows.length > 0;
    grid.el.hidden = rows.length === 0;
  };
  let lastShape = "";
  const refresh = async () => {
    const { windows: next } = await get("/api/windows", { background: true });
    const shape = JSON.stringify(next.map((w) => ({ ...w, review_seconds_left: null, opens_seconds_left: null })));
    windows = next;
    if (shape !== lastShape) {
      lastShape = shape;
      draw();
    } else {
      for (const w of next) if (w.review_seconds_left !== null) timerById.get(w.id)?.set(w.review_seconds_left);
    }
  };
  const setFilter = (state, announceIt) => {
    filter = state;
    draw();
    if (announceIt) announce(status, `${shown().length} windows shown.`);
  };

  opener.addEventListener("click", () => {
    const select = h("select", { id: "state-filter" }, h("option", { value: "", text: "All" }),
      STATES.map((name) => h("option", { value: name, text: name })));
    select.value = filter;
    const apply = h("button", { type: "button", text: "Apply" });
    const close = h("button", { type: "button", text: "Close" });
    const dialog = h("dialog", { class: "sheet field-yellow", "aria-label": "Filter windows" },
      h("div", { class: "stack" }, h("h2", { class: "dialog-title", text: "FILTER WINDOWS." }),
        h("p", { class: "muted", text: filter ? `Showing ${filter} windows.` : "Showing all nine states." }), h("label", { for: "state-filter", text: "State" }), select, h("div", { class: "row" }, apply, close)));
    const handle = openDialog(dialog, { opener, initial: select });
    close.addEventListener("click", () => handle.close());
    apply.addEventListener("click", () => {
      const next = select.value;
      handle.close();
      history.pushState(null, "", next ? `/windows?state=${encodeURIComponent(next)}` : "/windows");
      setFilter(next, true);
    });
  });

  refresh();
  const loop = poll(refresh, 2000);
  return {
    unmount() { loop.stop(); for (const t of timers) t.stop(); },
    onUrl(next) { setFilter(stateFromQuery(next), true); },
  };
}
