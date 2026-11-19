import { el, heading } from "../lib/dom.js";
import { Api, type ShelfLibrary } from "../lib/api.js";
import { buildHeader } from "../lib/header.js";

export async function shelfPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  buildHeader(root);

  const wrap = el("div", { class: "column", style: "max-width: none" });
  const body = el("div", { style: "max-width: 70ch; margin: 0 auto; padding: 24px" });
  body.appendChild(heading(1, "The shelf"));
  const intro = el("p", { text: "Pens load libraries only from this pinned shelf, served by the app itself." });
  body.appendChild(intro);

  const table = el("table", { class: "shelf-table" });
  table.setAttribute("aria-label", "Pinned libraries");
  const thead = el("thead");
  const headRow = el("tr");
  for (const h of ["Library", "Version", "Global", "Licence", "Size (bytes)"]) {
    headRow.appendChild(el("th", { text: h, scope: "col" }));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  const shelf = await Api.get<{ libraries: ShelfLibrary[] }>("/api/shelf");
  for (const lib of shelf.libraries) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: lib.name }));
    tr.appendChild(el("td", { text: lib.version }));
    tr.appendChild(el("td", { text: lib.global }));
    tr.appendChild(el("td", { text: lib.license }));
    tr.appendChild(el("td", { text: String(lib.bytes) }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
  wrap.appendChild(body);
  root.appendChild(wrap);
}
