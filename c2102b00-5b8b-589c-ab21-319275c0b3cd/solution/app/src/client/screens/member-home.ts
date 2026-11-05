// Member home: the open cycles, then the club's cycles from sealing through breakdown.
import { api } from "../api.js";
import { gridColumns, type Line } from "../line.js";
import { h, labelled } from "../dom.js";
import { main, useLive } from "../shell.js";

interface Summary {
  id: string;
  name: string;
  status: string;
  cutoff_display: string | null;
}

const IN_PROGRESS = ["sealing", "ordered", "received", "breakdown"];

const STRIP_WORD: Record<Line["status"], string> = { filling: "to go", sealed: "Sealed", taken_up: "Taken up", dropped: "Dropped" };

/** One case of an open cycle at a glance: its name, units to go and a small unit grid. */
function stripCase(line: Line): HTMLElement {
  const cells = h("span", { class: "strip-cells", "aria-hidden": "true" },
    ...line.cells.map((c) => h("span", { class: c })));
  cells.style.gridTemplateColumns = `repeat(${gridColumns(line.pack)}, minmax(0, 1fr))`;
  const tone = line.status === "sealed" || line.status === "taken_up" ? "is-sealed" : line.status === "dropped" ? "is-dropped" : "";
  return h("li", { class: `strip-case ${tone}` },
    h("span", { class: "strip-name" }, line.case_name),
    h("p", { class: "strip-figure" },
      h("span", { class: "strip-numeral" }, String(line.units_to_go)), " ",
      h("span", { class: "strip-word" }, STRIP_WORD[line.status])),
    cells);
}

function cycleLink(c: Summary, lines: Line[] = []): HTMLElement {
  return h("li", { class: "cycle-row" },
    h("a", { href: `/cycles/${encodeURIComponent(c.id)}`, class: "cycle-link" }, c.name),
    labelled("CUTOFF", c.cutoff_display ?? ""),
    h("p", { class: "state-word" }, c.status),
    lines.length ? h("ul", { class: "case-strip", "aria-label": `Cases in ${c.name}` }, ...lines.map(stripCase)) : null);
}

/** A stencilled empty case, drawn for the empty-cycle state. */
function emptyCase(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 84");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "empty-art");
  svg.innerHTML =
    '<rect x="4" y="18" width="112" height="62" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M4 18 L22 4 H98 L116 18" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M60 4 V18" stroke="currentColor" stroke-width="2"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="1.5">' +
    Array.from({ length: 8 }, (_, i) => `<rect x="${14 + (i % 4) * 24}" y="${28 + Math.floor(i / 4) * 24}" width="18" height="18"/>`).join("") +
    "</g>";
  return svg;
}

export async function memberHomeScreen(): Promise<void> {
  document.title = "Cycles · Tally Split";
  useLive();
  main.replaceChildren(h("p", { class: "loading" }, "Loading cycles"));
  const cycles: Summary[] = (await api("GET", "/api/cycles")).body.cycles;
  const open = cycles.filter((c) => c.status === "open");
  const running = cycles.filter((c) => IN_PROGRESS.includes(c.status));
  const details = await Promise.all(open.map((c) => api("GET", `/api/cycles/${encodeURIComponent(c.id)}`)));
  const linesOf = (i: number): Line[] => (details[i]!.status === 200 ? details[i]!.body.lines : []);
  main.replaceChildren(
    h("div", { class: "home grid" },
      h("section", { class: "span-8 panel" },
        h("h1", {}, "This week's case list"),
        open.length
          ? h("ul", { class: "cycle-list", "aria-label": "Open cycles" }, ...open.map((c, i) => cycleLink(c, linesOf(i))))
          : h("div", { class: "empty" }, emptyCase(),
              h("p", {}, "There's no open cycle right now. The next case list appears here when the coordinator opens it."))),
      h("div", { class: "span-4 home-side" },
        h("section", { class: "panel" },
          h("h2", {}, "In progress"),
          running.length
            ? h("ul", { class: "cycle-list compact", "aria-label": "Cycles in progress" }, ...running.map((c) => cycleLink(c)))
            : h("p", { class: "muted" }, "No cycle is being ordered or packed.")),
        h("section", { class: "panel home-credit" },
          h("h2", {}, "Credit"),
          h("p", { class: "muted" }, "Every top-up, charge and short-shipment credit, newest first."),
          h("a", { href: "/credit", class: "button quiet" }, "Credit history"))),
    ),
  );
}
