// Shared screen pieces: headings, status lines, responsive tables and label maps.
import { DATABASE_DOWN, type Answer } from "./api.js";
import { emptyGlyph, h } from "./dom.js";

type Cell = Node | string;

export function pageHead(title: string, lede: string): HTMLElement {
  return h("div", { class: "page-head" }, h("h1", { class: "page-title" }, title), h("p", { class: "page-lede" }, lede));
}

export function statusLine(label: string): HTMLElement {
  return h("p", { role: "status", "aria-label": label, class: "status-line" });
}

/** A table that reflows into stacked cards on narrow screens; each cell carries its column name. */
export function dataTable(label: string, columns: string[], rows: Cell[][], numeric: number[] = []): HTMLElement {
  return h("div", { class: "table-wrap" },
    h("table", { class: "data-table", "aria-label": label },
      h("thead", {}, h("tr", {}, ...columns.map((c, i) => h("th", { scope: "col", class: numeric.includes(i) ? "num" : null }, c)))),
      h("tbody", {}, ...rows.map((row) => h("tr", {}, ...row.map((cell, i) =>
        h("td", { "data-label": columns[i] ?? "", class: numeric.includes(i) ? "num" : null }, cell)))))));
}

export function emptyNote(text: string): HTMLElement {
  return h("div", { class: "empty" }, emptyGlyph(), h("p", { class: "empty-text" }, text));
}

export const mono = (text: string): HTMLElement => h("span", { class: "mono" }, text);

export const LICENCE_STATE: Record<string, string> = {
  active: "Active", pending_invoice: "Pending invoice", expired: "Expired", revoked: "Revoked",
};
export const INVOICE_STATE: Record<string, string> = { raised: "Raised", pending: "Pending" };
export const RECEIPT_STATE: Record<string, string> = { sent: "Sent", queued: "Queued", cancelled: "Cancelled" };
export const ESSAY_STATE: Record<string, string> = {
  draft: "Draft", in_review: "In review", embargoed: "Embargoed", live: "Live", withdrawn: "Withdrawn",
  taken_down: "Taken down",
};
export const KIND: Record<string, string> = { exclusive: "Exclusive", standard: "Standard" };

export function badge(text: string, tone: string): HTMLElement {
  return h("span", { class: `badge badge-${tone}` }, text);
}

/** Shows the database outage banner for a 503 load and hides it otherwise. */
export function outageFrom(answer: Answer<unknown> | null): void {
  const banner = document.getElementById("outage");
  if (!banner) return;
  const down = answer !== null && answer.status === 503;
  banner.hidden = !down;
  banner.textContent = down ? DATABASE_DOWN : "";
}
