import { api, connectLive, disconnectLive, onLiveMessage, el, clear, appEl, navigate, setPageError, ApiFailure, statusRegions } from "../app.js";
import type { Entrant, Match, Tournament } from "../../shared/types.js";
import { createMatchCard } from "../matchcard.js";
import { openDialogFor } from "../dialogs.js";

interface ShareMatch {
  id: string;
  label: string;
  bracket: string;
  round: number;
  number: number;
  upper: { name?: string; bye?: true } | null;
  lower: { name?: string; bye?: true } | null;
  state: string;
  upper_games: number | null;
  lower_games: number | null;
  winner: string | null;
  version: number;
}

interface ShareData {
  tournament: Tournament;
  entrants: { name: string; seed: number }[];
  matches: ShareMatch[];
}

export async function renderShare(code: string): Promise<() => void> {
  document.title = "Cupfold";
  const app = appEl();
  clear(app);
  let data: ShareData & { standings: { columns: string[]; rows: import("../../shared/types.js").StandingRow[] } | null };
  try {
    data = await api<ShareData & { standings: { columns: string[]; rows: import("../../shared/types.js").StandingRow[] } | null }>("GET", `/api/share/${code}`);
  } catch (e) {
    const msg = e instanceof ApiFailure ? e.body.message : "This link no longer works.";
    app.appendChild(el("main", { class: "page" }, [el("h1", {}, [msg])]));
    return () => {};
  }
  const t = data.tournament;
  const hero = el("section", { class: "hero" }, [
    el("div", { class: "stack" }, [
      el("h1", {}, [t.name]),
      el("p", { class: "muted" }, [`${t.entrant_count} entrants`]),
      el("ul", { class: "list-plain small", attrs: { role: "list", "aria-label": "Field" } },
        data.entrants.map((e) => el("li", {}, [`${e.seed}. ${e.name}`]))
      ),
    ]),
    el("div", { class: "stack" }, [
      el("div", { class: `tile tile--${t.fill}`, attrs: { style: "width:100%;max-width:420px" } }, []),
      t.logo_url ? el("img", { attrs: { src: `/api/share/${code}/logo`, alt: `${t.name} logo` } }) : null,
    ]),
  ]);

  const area = el("div", { class: "bracket-area" });
  const byBracket = new Map<string, ShareMatch[]>();
  for (const m of data.matches) {
    const list = byBracket.get(m.bracket) ?? [];
    list.push(m);
    byBracket.set(m.bracket, list);
  }
  const regionSpecs: { name: string; label: string; matches: ShareMatch[] }[] = [];
  if (t.format === "double_elimination") {
    if (byBracket.get("winners")) regionSpecs.push({ name: "winners", label: "Winners bracket", matches: byBracket.get("winners")! });
    if (byBracket.get("losers")) regionSpecs.push({ name: "losers", label: "Losers bracket", matches: byBracket.get("losers")! });
    if (byBracket.get("final")) regionSpecs.push({ name: "final", label: "Grand final", matches: byBracket.get("final")! });
  } else if (byBracket.get("main")) {
    regionSpecs.push({ name: "main", label: "Rounds", matches: byBracket.get("main")! });
  }
  for (const spec of regionSpecs) {
    const region = el("section", { class: "bracket-region", role: "region", ariaLabel: spec.label });
    const columns = el("div", { class: "bracket-columns" });
    const byRound = new Map<number, ShareMatch[]>();
    for (const m of spec.matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    for (const r of [...byRound.keys()].sort((a, b) => a - b)) {
      const col = el("div", { class: "bracket-round" });
      col.appendChild(el("div", { class: "bracket-round-title" }, [roundTitle(spec.name, r)]));
      for (const m of byRound.get(r)!) {
        const card = shareCard(m);
        col.appendChild(card);
      }
      columns.appendChild(col);
    }
    region.appendChild(columns);
    area.appendChild(region);
  }

  const main = el("main", { class: "page stack" }, [
    hero,
    area,
  ]);
  // the read-only standings follow the bracket for round robin and Swiss
  if (data.standings && data.standings.rows.length > 0) {
    const wrap = el("div", { attrs: { role: "region", "aria-label": "Standings", tabindex: "0" } });
    const table = el("table", { class: "standings", attrs: { "aria-label": "Standings" } }) as HTMLTableElement;
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const c of data.standings.columns) {
      const th = document.createElement("th");
      th.textContent = c;
      if (c !== "Entrant" && c !== "Decided by") th.className = "num";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const r of data.standings.rows) {
      const tr = document.createElement("tr");
      for (const c of data.standings.columns) {
        const td = document.createElement("td");
        td.textContent = shareCell(r, c);
        if (c !== "Entrant" && c !== "Decided by") td.className = "num";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    main.appendChild(wrap);
  }
  app.appendChild(main);

  connectLive(t.id, code, () => {}, () => {});
  const off = onLiveMessage((msg) => {
    if (msg.type === "match.updated" && msg.data.match) {
      const m = msg.data.match;
      const card = document.querySelector<HTMLElement>(`[data-match-id="${m.id}"]`);
      if (card) {
        card.dataset.state = m.state;
        redrawShareCard(card, m);
      }
    }
  });
  return () => {
    off();
    disconnectLive();
  };
}

function shareCard(m: ShareMatch): HTMLElement {
  const upper = m.upper?.name ?? (m.upper?.bye ? "bye" : "to be decided");
  const lower = m.lower?.name ?? (m.lower?.bye ? "bye" : "to be decided");
  const card = el("button", {
    class: `match-card match-card--${m.state}`,
    ariaLabel: `${m.label}: ${upper} vs ${lower}`,
    data: { matchId: m.id, round: String(m.round), match: String(m.number), bracket: m.bracket, state: m.state },
    on: { click: () => openShareDetails(m) },
  }, [
    el("div", { class: "card-label" }, [m.label]),
    el("div", { class: "card-slots" }, [el("span", {}, [upper]), el("span", {}, [lower])]),
    el("span", { class: "card-status" }, [statusWord(m.state)]),
  ]);
  return card;
}

function redrawShareCard(card: HTMLElement, m: import("../../shared/types.js").Match): void {
  const upper = m.upper ? ("name" in m.upper ? m.upper.name : "bye") : "to be decided";
  const lower = m.lower ? ("name" in m.lower ? m.lower.name : "bye") : "to be decided";
  card.setAttribute("aria-label", `${m.label}: ${upper} vs ${lower}`);
  card.className = `match-card match-card--${m.state}`;
  card.dataset.state = m.state;
  while (card.firstChild) card.removeChild(card.firstChild);
  card.appendChild(el("div", { class: "card-label" }, [m.label]));
  const slots = el("div", { class: "card-slots" }, [el("span", {}, [upper]), el("span", {}, [lower])]);
  if (m.upper_games !== null) slots.appendChild(el("span", { class: "card-score num" }, [`${m.upper_games}-${m.lower_games}`]));
  card.appendChild(slots);
  card.appendChild(el("span", { class: "card-status" }, [statusWord(m.state)]));
}

function statusWord(s: string): string {
  const map: Record<string, string> = {
    pending: "Pending",
    called: "Called",
    reported: "Awaiting confirmation",
    confirmed: "Confirmed",
    disputed: "Disputed",
    resolved: "Resolved",
    bye: "Bye",
    not_needed: "Not needed",
    waiting: "Waiting",
  };
  return map[s] ?? "Pending";
}

function roundTitle(region: string, r: number): string {
  if (region === "winners") return `Winners round ${r}`;
  if (region === "losers") return `Losers round ${r}`;
  if (region === "final") return r === 1 ? "Grand final" : "Grand final reset";
  return `Round ${r}`;
}

function openShareDetails(m: ShareMatch): void {
  const upper = m.upper?.name ?? (m.upper?.bye ? "bye" : "to be decided");
  const lower = m.lower?.name ?? (m.lower?.bye ? "bye" : "to be decided");
  const score = m.upper_games !== null ? ` · Score ${m.upper_games}-${m.lower_games}` : "";
  openReadonlySheet("Match details", [
    el("p", {}, [m.label]),
    el("p", { class: "small" }, [`${upper} vs ${lower}`]),
    el("p", { class: "small" }, [`Status: ${m.state.replace("_", " ")}${score}`]),
  ]);
}

function openReadonlySheet(title: string, fields: HTMLElement[]): void {
  const overlays = document.getElementById("overlays")!;
  const dialog = el("dialog", { class: "sheet" }) as HTMLDialogElement;
  const close = el("button", { class: "btn btn--secondary", on: { click: () => { dialog.close(); dialog.remove(); } } }, ["Close"]);
  dialog.appendChild(el("div", { class: "sheet-body" }, [
    el("h2", { class: "sheet-title", id: "sheet-title" }, [title]),
    ...fields,
    el("div", { class: "sheet-actions" }, [close]),
  ]));
  overlays.appendChild(dialog);
  dialog.showModal();
  close.focus();
}

export async function renderMe(tid: string): Promise<() => void> {
  document.title = "Your match · Cupfold";
  const app = appEl();
  clear(app);
  let me: { entrant: Entrant; checked_in: boolean; next_match: Match | null };
  try {
    me = await api<{ entrant: Entrant; checked_in: boolean; next_match: Match | null }>("GET", `/api/tournaments/${tid}/me`);
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) {
      app.appendChild(el("main", { class: "page" }, [el("h1", {}, ["We couldn't find that tournament."])]));
      return () => {};
    }
    throw e;
  }
  const t = await api<{ tournament: Tournament }>("GET", `/api/tournaments/${tid}`);
  const region = el("section", { class: "card stack", role: "region", attrs: { "aria-label": "Next match" } });
  void t;
  if (t.tournament.state !== "running") {
    region.appendChild(el("p", {}, ["You're checked in. Your first match appears here when the tournament starts."]));
  } else if (me.next_match) {
    const m = me.next_match;
    const card = createMatchCard(m, {
      isOrganizer: false,
      onOpen: (mm, cardEl) => openDialogFor(mm, { tournament: t.tournament, entrants: [me.entrant], matches: [m] }, false, cardEl, () => {}),
    });
    region.appendChild(card);
  } else {
    region.appendChild(el("p", {}, ["No more matches for you in this tournament."]));
  }
  app.appendChild(el("main", { class: "page stack" }, [
    el("h1", {}, [t.tournament.name]),
    region,
  ]));
  connectLive(tid, null, () => {}, () => {});
  const off = onLiveMessage(() => {
    // refresh the next match card in place
    void api<{ entrant: Entrant; checked_in: boolean; next_match: Match | null }>("GET", `/api/tournaments/${tid}/me`)
      .then((fresh) => {
        const host = region;
        while (host.firstChild) host.removeChild(host.firstChild);
        if (t.tournament.state !== "running") {
          host.appendChild(el("p", {}, ["You're checked in. Your first match appears here when the tournament starts."]));
        } else if (fresh.next_match) {
          host.appendChild(
            createMatchCard(fresh.next_match, {
              isOrganizer: false,
              onOpen: (mm, cardEl) => openDialogFor(mm, { tournament: t.tournament, entrants: [fresh.entrant], matches: [fresh.next_match!] }, false, cardEl, () => {}),
            })
          );
        } else {
          host.appendChild(el("p", {}, ["No more matches for you in this tournament."]));
        }
      })
      .catch(() => {
        /* the link may have ended */
      });
  });
  return () => {
    off();
    disconnectLive();
  };
}

export async function renderDisputes(tid: string): Promise<() => void> {
  document.title = "Open disputes · Cupfold";
  const app = appEl();
  clear(app);
  const data = await api<{ matches: Match[] }>("GET", `/api/tournaments/${tid}/disputes`);
  const entrants = await api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`);
  const list = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Open disputes" } });
  if (data.matches.length === 0) {
    list.appendChild(el("li", { class: "muted" }, ["No open disputes."]));
  }
  for (const m of data.matches) {
    const label = `${m.label}: ${m.upper && "name" in m.upper ? m.upper.name : ""} vs ${m.lower && "name" in m.lower ? m.lower.name : ""}`;
    list.appendChild(el("li", { class: "row" }, [
      label,
      el("button", {
        class: "btn",
        ariaLabel: `Resolve ${m.label}`,
        on: { click: () => navigate(`/t/${tid}/bracket?match=${m.id}`) },
      }, ["Resolve"]),
    ]));
  }
  app.appendChild(el("main", { class: "page stack" }, [
    statusRegions("disputes"),
    el("h1", {}, ["Open disputes"]),
    list,
  ]));
  void entrants;
  void setPageError;
  return () => {};
}

export async function renderHistory(username: string): Promise<() => void> {
  document.title = `${username} · Cupfold`;
  const app = appEl();
  clear(app);
  let rows: import("../../shared/types.js").HistoryRow[];
  try {
    const res = await api<{ rows: import("../../shared/types.js").HistoryRow[] }>("GET", `/api/users/${username}/history`);
    rows = res.rows;
  } catch {
    app.appendChild(el("main", { class: "page" }, [el("h1", {}, ["We couldn't find that page."])]));
    return () => {};
  }
  const list = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Tournament history" } });
  if (rows.length === 0) {
    list.appendChild(el("li", { class: "muted" }, ["No finished tournaments yet."]));
  }
  for (const r of rows) {
    list.appendChild(el("li", {}, [r.text]));
  }
  app.appendChild(el("main", { class: "page stack" }, [
    el("h1", {}, [username]),
    list,
  ]));
  return () => {};
}

function shareCell(r: import("../../shared/types.js").StandingRow, column: string): string {
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
      return half(r.buchholz_cut_1 ?? 0);
    case "Buchholz":
      return half(r.buchholz ?? 0);
    case "Sonneborn-Berger":
      return half(r.sonneborn_berger ?? 0);
    case "Seed":
      return String(r.seed);
    case "Decided by":
      return r.decided_by;
  }
  return "";
}

function half(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
