// Coordinator cycles: every cycle with its status and cutoff, and the new-cycle button.
import { api } from "../api.js";
import { h } from "../dom.js";
import { main, navigate, useLive } from "../shell.js";

interface Summary {
  id: string;
  name: string;
  status: string;
  cutoff_display: string | null;
}

export async function cyclesScreen(): Promise<void> {
  document.title = "Cycles · Tally Split";
  useLive("Coordinator updates");
  main.replaceChildren(h("p", { class: "loading" }, "Loading cycles"));
  const cycles: Summary[] = (await api("GET", "/api/cycles")).body.cycles;
  main.replaceChildren(
    h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h1", {}, "Cycles"),
        h("button", { type: "button", class: "button primary", onclick: () => navigate("/coordinator/cycles/new") }, "New cycle")),
      h("div", { class: "table-wrap" },
        h("table", { class: "table stack", "aria-label": "Cycles" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "NAME"), h("th", { scope: "col" }, "STATUS"), h("th", { scope: "col" }, "CUTOFF"))),
          h("tbody", {},
            ...cycles.map((c) =>
              h("tr", {},
                h("td", { "data-label": "NAME" }, h("a", { href: `/coordinator/cycles/${encodeURIComponent(c.id)}` }, c.name)),
                h("td", { "data-label": "STATUS" }, h("span", { class: `state-word state-${c.status}` }, c.status)),
                h("td", { "data-label": "CUTOFF" }, c.cutoff_display ?? "Not set"))),
          ))),
    ),
  );
}
