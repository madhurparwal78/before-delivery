// Lineup /boards (brief: Lineup): one band per board with every catalog fact, sizes with live stock badges,
// Build yours and Find a demo, then the compare table.
import { api } from "../api.ts";
import { BOARD_COPY } from "../content.ts";
import { h } from "../dom.ts";
import { boot } from "../boot.ts";
import { price } from "../format.ts";
import type { PageContext } from "../router.ts";
import { SLOT_NAMES, type Catalog } from "../catalog.ts";
import { badge, boardSilhouette, financingLine, onward, pageHead, scrollBox } from "../ui.ts";

export async function boards({ main }: PageContext): Promise<void> {
  document.title = "Boards | Tern Foils";
  main.append(pageHead("Three boards, one parts system", "Every Tern board takes the same snap-fit wings, masts, pods and packs it is built for."));
  const r = await api<Catalog>("GET", "/api/catalog");
  if (!r.ok) {
    main.append(h("div", { class: "wrap" }, h("p", { role: "alert" }, r.error.message)));
    return;
  }
  const catalog = r.data;
  const part = (sku: string) => catalog.components.find((c) => c.sku === sku)?.name ?? sku;
  const names = ["Drift", "Crest", "Swift"];
  for (const name of names) {
    const copy = BOARD_COPY[name]!;
    const sizes = catalog.boards.filter((b) => b.name === name);
    const first = sizes[0]!;
    const lowest = catalog.boards.find((b) => b.sku === boot.lineupFrom[name])!;
    main.append(h("section", { class: "band board-band", id: copy.anchor }, h("div", { class: "wrap board-band-grid" },
      h("div", { class: "board-band-art" }, boardSilhouette(name)),
      h("div", null,
        h("p", { class: "eyebrow" }, copy.rider),
        h("h2", null, name),
        h("p", null, copy.line),
        h("dl", { class: "specs" },
          h("div", { class: "spec" }, h("dt", null, "Finish"), h("dd", null, first.finish)),
          h("div", { class: "spec" }, h("dt", null, "Material"), h("dd", null, copy.material)),
          SLOT_NAMES.map(([slot, label]) => h("div", { class: "spec" }, h("dt", null, label), h("dd", null, part(first.defaults[slot]))))),
        h("h3", null, "Sizes"),
        h("ul", { class: "sizes" }, sizes.map((b) => h("li", null, h("span", null, `${b.name} ${b.size}`), h("span", { class: "caption" }, price(b.price_cents)), b.in_stock ? badge("In stock", "accent") : badge("Out of Stock")))),
        financingLine(lowest.as_low_as_cents),
        h("div", { class: "actions" }, h("a", { href: `/build?board=${first.sku}`, class: "pill" }, "Build yours"), onward("/locations", "Find a demo"))))));
  }
  const row = (label: string, value: (name: string) => string) =>
    h("tr", null, h("th", { scope: "row" }, label), names.map((n) => h("td", null, value(n))));
  const of = (name: string) => catalog.boards.filter((b) => b.name === name);
  main.append(h("section", { class: "band" }, h("div", { class: "wrap" },
    h("h2", null, "Compare the boards"),
    scrollBox("Board comparison", h("table", { class: "compare-table" },
      h("thead", null, h("tr", null, h("td"), names.map((n) => h("th", { scope: "col" }, n)))),
      h("tbody", null,
        row("Finish", (n) => of(n)[0]?.finish ?? ""),
        row("Sizes", (n) => of(n).map((b) => b.size).join(", ")),
        row("From", (n) => price(catalog.boards.find((b) => b.sku === boot.lineupFrom[n])!.price_cents)),
        SLOT_NAMES.map(([slot, label]) => row(label, (n) => part(of(n)[0]!.defaults[slot])))))))));
}
