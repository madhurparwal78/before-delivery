// Shared screen scaffolding: titles, panels, tables that stack into cards at 375, empty states.
import { get } from "../api.js";
import { h, say } from "../dom.js";
import { emptyTray } from "../icons.js";

export function screen(title, ...children) {
  return h("section", { class: "screen" }, h("header", { class: "screen-head" }, h("h1", { text: title })), ...children);
}

// Adds a screen once its first load settles, so content arriving never shifts what is already drawn;
// a reader who has moved on to another screen by then keeps that screen.
export function showAfter(work, loading, page) {
  const view = work.dataset.view;
  loading.finally(() => {
    if (work.dataset.view === view) work.append(page);
  });
}

export function panel(heading, ...children) {
  return h("section", { class: "panel", "aria-label": heading || null },
    heading ? h("h2", { class: "panel-title", text: heading }) : null, ...children);
}

// A table with explicit roles so it keeps its semantics when it is restyled as cards at 375.
export function table(name, columns, rows) {
  return h("table", { class: "data", "aria-label": name, role: "table" },
    h("thead", { role: "rowgroup" }, h("tr", { role: "row" },
      columns.map((c) => h("th", { scope: "col", role: "columnheader", text: c })))),
    h("tbody", { role: "rowgroup" }, rows.map((cells) => h("tr", { role: "row" },
      cells.map((cell, i) => h("td", { role: "cell", "data-label": columns[i] }, cell))))));
}

export function empty(text) {
  return h("div", { class: "empty" }, emptyTray(), h("p", { text }));
}

// Fetches a fresh signed link and follows it; storage serves the file as an attachment, so the browser
// downloads it under its published name and the page stays where it is.
export async function downloadSigned(path, region) {
  say(region, "Opening…", "pending");
  try {
    const { url } = await get(path);
    location.assign(url);
    say(region, "", "info");
  } catch (error) {
    say(region, error.message, "error");
  }
}
