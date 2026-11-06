// Index tables and season standings screens.
import { api, type IndexTableObj, type SeasonRow, type EventObj } from "../api.js";
import { h, liveRegion, announce, errorMessage, errorFields, fixFieldsAlert, pendingButton } from "../ui.js";
import { state, shell } from "../client.js";

export async function renderIndexTables(): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Index table updates");
  content.appendChild(region);
  await shell(content);

  const root = document.querySelector(".content") as HTMLElement;
  root.appendChild(h("h1", { text: "Index tables" }));

  const { tables } = await api.get<{ tables: IndexTableObj[] }>("/api/index-tables");
  for (const table of tables) {
    const el = h("table", { class: "data", "aria-label": `Index table effective ${table.effectiveDate}` }) as HTMLTableElement;
    el.appendChild(h("thead", null, h("tr", null, h("th", { text: "Class" }), h("th", { class: "mono", text: "Factor" }))));
    const tbody = h("tbody", null);
    for (const cls of Object.keys(table.factors).sort()) {
      tbody.appendChild(h("tr", null, h("td", { text: cls }), h("td", { class: "mono", text: table.factors[cls] })));
    }
    el.appendChild(tbody);
    const wrap = h("div", { class: "panel" });
    wrap.appendChild(h("h2", { text: `Effective ${table.effectiveDate}` }));
    wrap.appendChild(el);
    root.appendChild(wrap);
  }

  const roles = state.user?.roles ?? [];
  if (roles.includes("chair")) {
    const form = h("form", { class: "panel" }) as HTMLFormElement;
    const fields: Record<string, HTMLElement> = {};
    const date = document.createElement("input");
    date.placeholder = "YYYY-MM-DD";
    fields.effectiveDate = date;
    const factors = document.createElement("textarea");
    factors.placeholder = "SS 0.8270\nSTR 0.8290";
    fields.factors = factors;
    const load = h<HTMLButtonElement>("button", { class: "primary", type: "submit", text: "Load table" });
    form.appendChild(h("div", { class: "field" }, h("label", { text: "Effective date" }), date));
    form.appendChild(h("div", { class: "field" }, h("label", { text: "Factors" }), factors));
    form.appendChild(load);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const restore = pendingButton(load, "Loading table");
      const parsed: Record<string, string> = {};
      for (const line of factors.value.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 2) parsed[parts[0].toUpperCase()] = parts[1];
      }
      try {
        const result = await api.post<{ table: IndexTableObj }>("/api/index-tables", { effectiveDate: date.value, factors: parsed });
        announce(region, `Index table effective ${result.table.effectiveDate} loaded.`);
        await renderIndexTables();
      } catch (err) {
        announce(region, errorMessage(err));
        const fieldErrors = errorFields(err);
        if (Object.keys(fieldErrors).length > 0) {
          form.querySelector(".alert-fix")?.remove();
          form.insertBefore(fixFieldsAlert(fieldErrors, fields), form.firstChild);
        }
        restore();
      }
    });
    root.appendChild(form);
  }
}

export async function renderSeason(): Promise<void> {
  const content = h("div", null);
  const region = liveRegion("Season updates");
  content.appendChild(region);
  await shell(content);

  const root = document.querySelector(".content") as HTMLElement;
  const club = state.user?.club;
  const query = club ? `?year=${yearInZone(club.timeZone)}` : "";
  const data = await api.get<{ year: number; events: { id: string; name: string; date: string }[]; rows: SeasonRow[] }>(`/api/season${query}`);

  root.appendChild(h("h1", { text: `Season standings ${data.year}` }));

  const table = h("table", { class: "data", "aria-label": "Season standings" }) as HTMLTableElement;
  table.appendChild(h("thead", null, h("tr", null,
    h("th", { text: "Position" }),
    h("th", { text: "Driver" }),
    h("th", { text: "Car" }),
    h("th", { text: "Class" }),
    h("th", { text: "Events" }),
    h("th", { class: "mono", text: "Points" }),
  )));
  const tbody = h("tbody", null);
  for (const row of data.rows) {
    tbody.appendChild(h("tr", null,
      h("td", { class: "mono", text: String(row.position) }),
      h("td", { text: row.driverName }),
      h("td", { text: row.carDescription }),
      h("td", { text: row.classCode }),
      h("td", { class: "mono", text: String(row.events) }),
      h("td", { class: "mono", text: row.points }),
    ));
  }
  table.appendChild(tbody);
  root.appendChild(table);

  const exportButton = h<HTMLButtonElement>("button", {
    class: "primary",
    text: "Export standings CSV",
    onclick: async (e: Event) => {
      const restore = pendingButton(e.currentTarget as HTMLButtonElement, "Preparing CSV");
      try {
        const res = await fetch(`/api/season.csv?year=${data.year}`, { credentials: "same-origin" });
        if (!res.ok) throw new Error("CSV failed");
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `season-standings-${data.year}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        announce(region, "Standings CSV downloaded.");
      } catch (err) {
        announce(region, errorMessage(err));
      } finally {
        restore();
      }
    },
  });
  root.appendChild(h("div", { style: "height:12px" }));
  root.appendChild(exportButton);
  void content;
}

function yearInZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(new Date());
  return Number(parts);
}

export async function renderEventIndexLine(event: EventObj): Promise<HTMLElement> {
  const line = h("div", { class: "status-line", text: `Index table effective ${event.indexTable.effectiveDate}` });
  return line;
}
