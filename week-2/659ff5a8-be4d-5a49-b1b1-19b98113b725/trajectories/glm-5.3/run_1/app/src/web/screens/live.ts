// Live results: view tabs, class filter, in-place updates and the settle.
import { api, type EventObj, type StandingsRowObj, type RunObj } from "../api.js";
import { h, liveRegion, announce } from "../ui.js";
import { shell, eventSectionsNav } from "../client.js";

type View = "indexed" | "class" | "raw";

export async function renderLive(eventId: string): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Standings updates");
  content.appendChild(region);
  const body = h("div", null);
  content.appendChild(body);
  await shell(content, { eventId });

  let view: View = "indexed";
  let classFilter = "";
  let lastUpdate = "";

  const draw = async (announceChange = false) => {
    await api.get<{ event: EventObj }>(`/api/events/${eventId}`);
    const query = new URLSearchParams({ view });
    if (classFilter) query.set("class", classFilter);
    const data = await api.get<{ rows: StandingsRowObj[]; updatedAt: string }>(`/api/events/${eventId}/standings?${query}`);
    const fresh = data.rows.filter((r) => r.lastChange && r.lastChange.at !== lastUpdate);
    if (announceChange && fresh.length > 0) {
      for (const row of fresh) {
        const badge = badgeFor(view, row);
        announce(region, `Car ${row.carNumber} ${row.classCode}: ${badge}`);
      }
      lastUpdate = fresh[fresh.length - 1].lastChange?.at ?? lastUpdate;
    }
    if (!announceChange && data.rows.some((r) => r.lastChange && r.lastChange.at !== lastUpdate)) {
      for (const row of data.rows) {
        if (row.lastChange && row.lastChange.at !== lastUpdate) {
          const badge = badgeFor(view, row);
          announce(region, `Car ${row.carNumber} ${row.classCode}: ${badge}`);
          lastUpdate = row.lastChange.at;
        }
      }
    }
    await paint(data.rows, view);
  };

  const { event } = await api.get<{ event: EventObj }>(`/api/events/${eventId}`);

  body.appendChild(eventSectionsNav(event, "live"));

  // Tabs and filter stay mounted; only the standings container re-renders.
  const tabs = h("div", { class: "timing-header", role: "tablist", "aria-label": "Standings view" });
  for (const v of ["indexed", "class", "raw"] as View[]) {
    tabs.appendChild(h("button", {
      role: "tab",
      text: v === "indexed" ? "Indexed" : v === "class" ? "Class" : "Raw",
      "aria-selected": v === view ? "true" : "false",
      onclick: async (e: Event) => {
        view = v;
        for (const child of Array.from(tabs.children)) (child as HTMLElement).setAttribute("aria-selected", String(child === e.currentTarget));
        await draw(false);
      },
    }));
  }
  body.appendChild(tabs);

  const filter = document.createElement("select");
  filter.setAttribute("aria-label", "Class filter");
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All classes";
  filter.appendChild(allOption);
  for (const cls of event.heats.flatMap((hh) => hh.classes).sort()) {
    const option = document.createElement("option");
    option.value = cls;
    option.textContent = cls;
    filter.appendChild(option);
  }
  filter.addEventListener("change", () => {
    classFilter = filter.value;
    void draw(false);
  });
  body.appendChild(filter);
  body.appendChild(h("div", { style: "height:12px" }));

  const container = h("div", null);
  body.appendChild(container);

  await draw(false);
  const timer = setInterval(() => void draw(true), 2000);
  window.addEventListener("hashchange", () => clearInterval(timer), { once: true });
  void container;
}

function badgeFor(view: View, row: StandingsRowObj): string {
  if (!row.lastChange) return "No time";
  if (view === "indexed") return row.lastChange.rankChange.indexed;
  if (view === "class") return row.lastChange.rankChange.class;
  return row.lastChange.rankChange.raw;
}

/** Paint the standings: full table at >=1024px, card list below. */
async function paint(rows: StandingsRowObj[], view: View): Promise<void> {
  const wide = window.matchMedia("(min-width: 1024px)").matches;
  const narrow = window.matchMedia("(max-width: 599px)").matches;
  const existing = document.querySelector('[data-standings="1"]');
  existing?.remove();

  const container = h("div", null);
  container.setAttribute("data-standings", "1");

  const best = (row: StandingsRowObj): string => {
    if (view === "indexed") return row.bestIndexed ?? "No time";
    return row.bestAdjusted ?? "No time";
  };

  if (wide) {
    const table = h("table", { class: "data", "aria-label": "Live standings" }) as HTMLTableElement;
    const head = h("tr", null,
      h("th", { text: "Pos" }),
      h("th", { text: "Car" }),
      h("th", { text: "Class" }),
      h("th", { text: "Driver" }),
      h("th", { text: "Car description" }),
      h("th", { class: "mono", text: "Best adjusted" }),
      h("th", { class: "mono", text: "Best indexed" }),
      h("th", { text: "Change" }),
      h("th", { text: "Runs" }),
    );
    table.appendChild(h("thead", null, head));
    const tbody = h("tbody", null);
    for (const row of rows) {
      const tr = h("tr", null);
      tr.appendChild(h("td", { class: "mono", text: row.position !== null ? `P${row.position}` : "No time" }));
      tr.appendChild(h("td", { class: "mono", text: String(row.carNumber) }));
      tr.appendChild(h("td", { text: row.classCode }));
      tr.appendChild(h("td", { text: row.driverName }));
      tr.appendChild(h("td", { class: "dim", text: row.carDescription }));
      tr.appendChild(h("td", { class: "mono", text: row.bestAdjusted ?? "No time" }));
      tr.appendChild(h("td", { class: "mono", text: row.bestIndexed ?? "No time" }));
      tr.appendChild(h("td", { class: "badge", text: badgeFor(view, row) }));
      tr.appendChild(runsCell(row));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    const list = h("div", { class: `standings-cards${narrow ? " single" : ""}`, role: "list", "aria-label": "Live standings" });
    for (const row of rows) {
      const item = h("div", { class: "card", role: "listitem" });
      item.appendChild(h("div", { class: "pos", text: row.position !== null ? `P${row.position}` : "No time" }));
      item.appendChild(h("div", { class: "car", text: `${row.carNumber} ${row.classCode}` }));
      item.appendChild(h("div", { class: "change badge", text: badgeFor(view, row) }));
      item.appendChild(h("div", { class: "driver", text: row.driverName }));
      item.appendChild(h("div", { class: "best mono", text: best(row) }));
      item.appendChild(runsButton(row, narrow));
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  const mount = document.querySelector(".event-layout .content") ?? document.querySelector(".content");
  (mount as HTMLElement | null)?.appendChild(container);
}

/** The runs button: at least 44 by 44, toggling run details. */
function runsButton(row: StandingsRowObj, narrow: boolean): HTMLElement {
  const details = h("div", { class: "runs-detail", hidden: true });
  for (const run of row.runs) {
    details.appendChild(h("div", { text: runLine(run) }));
  }
  const button = h("button", {
    class: "row-button",
    text: `Runs for car ${row.carNumber} ${row.classCode}`,
    "aria-expanded": "false",
    onclick: (e: Event) => {
      const expanded = (e.currentTarget as HTMLButtonElement).getAttribute("aria-expanded") === "true";
      (e.currentTarget as HTMLButtonElement).setAttribute("aria-expanded", String(!expanded));
      details.hidden = expanded;
    },
  });
  button.style.minHeight = "44px";
  const wrap = h("div", null, narrow ? button : button, details);
  return wrap;
}

function runLine(run: RunObj): string {
  if (run.outcome === "dnf") return `Run ${run.runNumber}: DNF`;
  if (run.outcome === "rerun") return `Run ${run.runNumber}: RRN`;
  if (!run.rawTime) return `Run ${run.runNumber}: pending`;
  return `Run ${run.runNumber}: ${run.rawTime} +${run.cones ?? 0}, adjusted ${run.adjustedTime}, indexed ${run.indexedTime}`;
}

function runsCell(row: StandingsRowObj): HTMLElement {
  const td = h("td", null);
  td.appendChild(runsButton(row, false));
  return td;
}
