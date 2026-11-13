import { api, el, onLiveMessage } from "../app.js";
import type { Match, StandingRow, Tournament } from "../../shared/types.js";

export function renderStandingsTable(
  t: Tournament,
  _data: { tournament: Tournament; entrants: import("../../shared/types.js").Entrant[]; matches: Match[] },
  _isOrganizer: boolean
): HTMLElement {
  const host = el("div", { class: "stack" });
  const wrap = el("div", { attrs: { role: "region", "aria-label": "Standings", tabindex: "0" } });
  const table = el("table", { class: "standings", attrs: { "aria-label": "Standings" } }) as HTMLTableElement;
  const drawRows = (columns: string[], rows: StandingRow[]): void => {
    while (table.firstChild) table.removeChild(table.firstChild);
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const c of columns) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c !== "Entrant" && c !== "Decided by") th.className = "num";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");
      for (const c of columns) {
        const td = document.createElement("td");
        td.textContent = cellValue(r, c);
        if (c !== "Entrant" && c !== "Decided by") td.className = "num";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  };
  wrap.appendChild(table);
  host.appendChild(wrap);
  const refresh = (): void => {
    void api<{ columns: string[]; rows: StandingRow[] }>("GET", `/api/tournaments/${t.id}/standings`)
      .then((res) => drawRows(res.columns, res.rows))
      .catch(() => {
        /* elimination formats have no standings */
      });
  };
  refresh();
  const off = onLiveMessage((msg) => {
    if (msg.type === "standings.updated" || msg.type === "match.updated" || msg.type === "matches.reset") refresh();
  });
  cleanupFns.push(off);
  return host;
}

export const cleanupFns: (() => void)[] = [];

function cellValue(r: StandingRow, column: string): string {
  switch (column) {
    case "Place":
      return String(r.place);
    case "Entrant":
      return r.name;
    case "Played":
      return String(r.played);
    case "Match points":
      return String(r.match_points);
    case "Head-to-head":
      return String(r.head_to_head ?? 0);
    case "Game difference": {
      const v = r.game_difference ?? 0;
      return v > 0 ? `+${v}` : String(v);
    }
    case "Games won":
      return String(r.games_won ?? 0);
    case "Buchholz cut 1":
      return formatHalf(r.buchholz_cut_1 ?? 0);
    case "Buchholz":
      return formatHalf(r.buchholz ?? 0);
    case "Sonneborn-Berger":
      return formatHalf(r.sonneborn_berger ?? 0);
    case "Seed":
      return String(r.seed);
    case "Decided by":
      return r.decided_by;
  }
  return "";
}

function formatHalf(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
