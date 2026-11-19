// History: matches and the lap board.
import { api, type HistoryMatch, type LapEntry } from "./api";
import { el, clear, openDialog } from "./ui";
import { fmtLapMs } from "./format";
import type { App } from "./main";

export function openHistoryPanel(app: App): void {
  openDialog({
    label: "History",
    build(root): void {
      root.classList.add("wide");
      root.append(el("h2", { text: "History" }));

      const tablist = el("div", { class: "tabs", role: "tablist", "aria-label": "History" });
      const tabMatches = el("button", { class: "tab", role: "tab", "aria-selected": "true", text: "Matches" });
      const tabLaps = el("button", { class: "tab", role: "tab", "aria-selected": "false", text: "Lap board" });
      tablist.append(tabMatches, tabLaps);
      root.append(tablist);

      const matchesPanel = el("div", { role: "tabpanel" });
      const lapsPanel = el("div", { role: "tabpanel" });
      lapsPanel.hidden = true;
      root.append(matchesPanel, lapsPanel);

      function selectTab(which: "matches" | "laps"): void {
        tabMatches.setAttribute("aria-selected", String(which === "matches"));
        tabLaps.setAttribute("aria-selected", String(which === "laps"));
        matchesPanel.hidden = which !== "matches";
        lapsPanel.hidden = which !== "laps";
      }
      tabMatches.addEventListener("click", () => selectTab("matches"));
      tabLaps.addEventListener("click", () => selectTab("laps"));

      tablist.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { selectTab("laps"); tabLaps.focus(); }
        if (e.key === "ArrowLeft") { selectTab("matches"); tabMatches.focus(); }
      });

      async function loadMatches(): Promise<void> {
        const res = await api.get<{ matches: HistoryMatch[] }>("/history");
        clear(matchesPanel);
        if (!res.body) {
          matchesPanel.append(el("div", { class: "empty", text: "History is offline right now." }));
          return;
        }
        if (res.body.matches.length === 0) {
          matchesPanel.append(el("div", { class: "empty", text: "No matches yet." }));
          return;
        }
        const table = el("table", { role: "table", "aria-label": "Match history" });
        table.append(el("thead", {}, el("tr", {},
          el("th", { class: "history-hide-narrow", text: "Started" }),
          el("th", { class: "history-hide-narrow", text: "Ended" }),
          el("th", { class: "history-hide-narrow", text: "Room" }),
          el("th", { text: "Mode" }), el("th", { text: "Result" }),
          el("th", { text: "Waves cleared" }), el("th", { text: "Squad" }))));
        const tbody = el("tbody");
        for (const m of res.body.matches) {
          const squad = m.players.map((p) =>
            m.mode === "siege" ? `${p.callsign} ${p.score}` : `${p.callsign} ${p.best_lap_ms ? fmtLapMs(p.best_lap_ms) : "—"}`
          ).join(" · ");
          tbody.append(el("tr", {},
            el("td", { class: "history-hide-narrow", text: fmtDateTime(m.started_at) }),
            el("td", { class: "history-hide-narrow", text: fmtDateTime(m.ended_at) }),
            el("td", { class: "history-hide-narrow", text: m.code }),
            el("td", { text: m.mode === "siege" ? "Siege" : "Convoy" }),
            el("td", { text: resultText(m.result) }),
            el("td", { class: "num-cell", text: m.mode === "convoy" ? "—" : String(m.waves_cleared) }),
            el("td", { text: squad }),
          ));
        }
        table.append(tbody);
        matchesPanel.append(table);
      }

      async function loadLaps(): Promise<void> {
        const res = await api.get<{ laps: LapEntry[] }>("/laps");
        clear(lapsPanel);
        if (!res.body) {
          lapsPanel.append(el("div", { class: "empty", text: "The lap board is offline right now." }));
          return;
        }
        if (res.body.laps.length === 0) {
          lapsPanel.append(el("div", { class: "empty", text: "No laps yet." }));
          return;
        }
        const table = el("table", { role: "table", "aria-label": "Lap board" });
        table.append(el("thead", {}, el("tr", {},
          el("th", { text: "Rank" }), el("th", { text: "Callsign" }),
          el("th", { text: "Best lap" }), el("th", { text: "Set on" }))));
        const tbody = el("tbody");
        for (const l of res.body.laps) {
          tbody.append(el("tr", {},
            el("td", { class: "num-cell", text: String(l.rank) }),
            el("td", { text: l.callsign }),
            el("td", { class: "num-cell", text: fmtLapMs(l.lap_ms) }),
            el("td", { text: fmtDate(l.set_at) }),
          ));
        }
        table.append(tbody);
        lapsPanel.append(table);
      }

      void loadMatches();
      void loadLaps();
    },
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date} ${time} UTC`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function resultText(r: string): string {
  return r === "victory" ? "Victory" : r === "defeat" ? "Defeat" : r === "finished" ? "Finished" : "Ended";
}
