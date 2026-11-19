// Tables built with explicit ARIA roles so the semantics survive the stacked phone layout.
import { h } from "./dom.js";

export function table(label, columns, template = "") {
  const head = h("div", { role: "row", class: "tr thead" }, columns.map((name) => h("div", { role: "columnheader", class: "th", text: name })));
  const body = h("div", { role: "rowgroup", class: "tbody" });
  const el = h("div", { role: "table", "aria-label": label, class: "table", style: template ? `--cols:${template}` : null },
    h("div", { class: "table-grid" }, h("div", { role: "rowgroup", class: "thead-group" }, head), body));
  return { el, body };
}

export function row(cells, attrs = {}) {
  return h("div", { role: "row", class: "tr", ...attrs },
    cells.map(([header, content]) => h("div", { role: "cell", class: "td", "data-label": header }, content)));
}
