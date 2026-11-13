import {
  api,
  connectLive,
  disconnectLive,
  onLiveMessage,
  el,
  clear,
  appEl,
  navigate,
  setPageNotice,
  setPageError,
  state,
  ApiFailure,
  statusRegions,
} from "../app.js";
import type { Entrant, LiveMessage, Match, Tournament } from "../../shared/types.js";
import { createMatchCard, updateMatchCard, type CardView } from "../matchcard.js";
import { openDialogFor, focusCard } from "../dialogs.js";
import { renderStandingsTable } from "./standings.js";

interface PageData {
  tournament: Tournament;
  entrants: Entrant[];
  matches: Match[];
}

export async function renderBracket(tid: string): Promise<() => void> {
  document.title = "Bracket · Cupfold";
  const app = appEl();
  clear(app);
  let data: PageData;
  try {
    data = await load(tid);
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) {
      app.appendChild(el("main", { class: "page" }, [el("h1", {}, ["We couldn't find that tournament."])]));
      return () => {};
    }
    throw e;
  }
  const isOrganizer = data.tournament.my_role === "organizer" || data.tournament.my_role === "co_organizer";
  const view: CardView = {
    isOrganizer,
    onOpen: (m, card) => {
      // the card may be stale after live updates; act on the freshest state
      const fresh = data.matches.find((x) => x.id === m.id) ?? m;
      openDialogFor(fresh, data, isOrganizer, card, redraw);
    },
  };

  const build = (): void => {
    const t = data.tournament;
    const isPhone = window.innerWidth < 768;
    const host = el("div", {});
    app.appendChild(host);
    draw(host, t, data, isOrganizer, isPhone);
  };

  const redraw = (): void => {
    while (app.firstChild) app.removeChild(app.firstChild);
    build();
  };

  const applyLive = (msg: LiveMessage): void => {
    if (msg.type === "match.updated" && msg.data.match) {
      const idx = data.matches.findIndex((m) => m.id === msg.data.match!.id);
      if (idx >= 0) data.matches[idx] = msg.data.match;
      updateMatchCard(msg.data.match, view);
    } else if (msg.type === "matches.reset" && msg.data.matches) {
      for (const m of msg.data.matches) {
        const idx = data.matches.findIndex((x) => x.id === m.id);
        if (idx >= 0) data.matches[idx] = m;
        updateMatchCard(m, view);
      }
    } else if (msg.type === "entrants.updated" && msg.data.entrants) {
      data.entrants = msg.data.entrants;
    } else if (msg.type === "tournament.updated" && msg.data.tournament) {
      data.tournament = { ...data.tournament, ...msg.data.tournament };
    } else if (msg.type === "announcement" && msg.data.text) {
      // the same announcement text reads on every screen
      const node = document.getElementById("bracket-announcements");
      if (node) node.textContent = msg.data.text;
    }
  };

  connectLive(tid, null, () => { state.liveDown = true; redraw(); }, () => { state.liveDown = false; redraw(); });
  const off = onLiveMessage((msg) => applyLive(msg));

  build();
  // ?match=<id> focuses that card on load, and a disputed card opens its dialog
  // straight away (the organizer arrived from the disputes list)
  const wanted = new URLSearchParams(location.search).get("match");
  if (wanted) {
    focusCard(wanted);
    const m = data.matches.find((x) => x.id === wanted);
    if (m && m.state === "disputed" && isOrganizer) {
      const card = document.querySelector<HTMLElement>(`[data-match-id="${wanted}"]`);
      if (card) openDialogFor(m, data, isOrganizer, card, () => {});
    }
  }

  return () => {
    off();
    disconnectLive();
  };
}

export async function load(tid: string): Promise<PageData> {
  const tournament = await api<{ tournament: Tournament }>("GET", `/api/tournaments/${tid}`);
  const entrants = await api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`);
  const matches = await api<{ matches: Match[] }>("GET", `/api/tournaments/${tid}/matches`);
  return { tournament: tournament.tournament, entrants: entrants.entrants, matches: matches.matches };
}

function draw(
  host: HTMLElement,
  t: Tournament,
  data: PageData,
  isOrganizer: boolean,
  isPhone: boolean
): void {
  const view: CardView = {
    isOrganizer,
    onOpen: (m, card) => {
      const fresh = data.matches.find((x) => x.id === m.id) ?? m;
      openDialogFor(fresh, data, isOrganizer, card, () => {});
    },
  };
  const rail = el("aside", { class: "stack" });
  rail.appendChild(el("h2", {}, [t.name]));
  rail.appendChild(el("div", { class: "small muted" }, [t.state.replace("_", " ")]));
  if (t.state === "checkin_open" || t.state === "checkin_closed") {
    rail.appendChild(
      el("div", { class: "small", attrs: { role: "status", "aria-label": "Check-in count" } }, [
        `${t.checked_in_count} of ${t.entrant_count} checked in`,
      ])
    );
    const closes = t.checkin_closes_at ? formatZoneTime(t.checkin_closes_at, t.time_zone) : null;
    if (closes) {
      rail.appendChild(el("div", { class: "small muted" }, [
        t.state === "checkin_open" ? `Check-in closes at ${closes} (${t.time_zone})` : `Check-in closed at ${closes} (${t.time_zone})`,
      ]));
    }
  }
  if (t.state === "checkin_open" && !isOrganizer && t.my_role === "player") {
    rail.appendChild(el("button", {
      class: "btn",
      on: {
        click: async () => {
          try {
            await api("POST", `/api/tournaments/${t.id}/checkin`);
            navigate(`/t/${t.id}/me`);
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Check in"]));
  }
  if (isOrganizer && t.state === "running" && t.format === "swiss") {
    rail.appendChild(el("button", {
      class: "btn",
      on: {
        click: async () => {
          try {
            await api("POST", `/api/tournaments/${t.id}/rounds`);
            setPageNotice(`Round paired`);
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Start next round"]));
  }
  rail.appendChild(el("button", {
    class: "btn btn--secondary",
    attrs: { "data-whole-bracket": "1", "aria-pressed": "false" },
    on: { click: toggleWholeBracket },
  }, ["Whole bracket"]));

  const area = el("div", { class: "bracket-area", attrs: { tabindex: "0" } });
  const regions: { name: string; label: string; matches: Match[] }[] = [];
  const byBracket = new Map<string, Match[]>();
  for (const m of data.matches) {
    const list = byBracket.get(m.bracket) ?? [];
    list.push(m);
    byBracket.set(m.bracket, list);
  }
  if (t.format === "double_elimination") {
    if (byBracket.get("winners")?.length) regions.push({ name: "winners", label: "Winners bracket", matches: byBracket.get("winners")! });
    if (byBracket.get("losers")?.length) regions.push({ name: "losers", label: "Losers bracket", matches: byBracket.get("losers")! });
    if (byBracket.get("final")?.length) regions.push({ name: "final", label: "Grand final", matches: byBracket.get("final")! });
  } else {
    if (byBracket.get("main")?.length) {
      regions.push({ name: "main", label: t.format === "single_elimination" ? "Bracket" : "Rounds", matches: byBracket.get("main")! });
    }
  }
  const deStack = t.format === "double_elimination" ? el("div", { class: "de-stack" }) : null;
  for (const r of regions) {
    const region = buildRegion(r, view);
    if (deStack) deStack.appendChild(region);
    else area.appendChild(region);
  }
  if (deStack) area.appendChild(deStack);

  const main = el("main", { class: "page" });
  for (const region of statusRegions("bracket")) main.appendChild(region);
  const standings = (t.format === "round_robin" || t.format === "swiss")
    ? renderStandingsTable(t, data, false)
    : null;
  if (isPhone) {
    main.appendChild(el("div", { class: "stack" }, [
      el("div", { class: "spread" }, [
        el("h2", {}, [t.name]),
        el("div", { class: "small muted" }, [t.state.replace("_", " ")]),
      ]),
      rail,
      phoneTabs(area, data, isOrganizer, t, view),
      standings,
    ]));
  } else {
    main.appendChild(el("div", { class: "rail-layout" }, [
      rail,
      el("div", { class: "stack" }, [area, standings]),
    ]));
  }
  host.appendChild(main);
}

function buildRegion(spec: { name: string; label: string; matches: Match[] }, view: CardView): HTMLElement {
  const region = el("section", { class: "bracket-region", role: "region", ariaLabel: spec.label });
  const columns = el("div", { class: "bracket-columns" });
  const byRound = new Map<number, Match[]>();
  for (const m of spec.matches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }
  for (const r of [...byRound.keys()].sort((a, b) => a - b)) {
    const col = el("div", { class: "bracket-round", data: { round: String(r) } });
    col.appendChild(el("div", { class: "bracket-round-title" }, [roundTitle(spec.name, r)]));
    for (const m of byRound.get(r)!) col.appendChild(createMatchCard(m, view));
    columns.appendChild(col);
  }
  region.appendChild(columns);
  attachRegionKeys(region, spec.matches, view);
  return region;
}

function toggleWholeBracket(ev: Event): void {
  const btn = ev.currentTarget as HTMLButtonElement;
  const whole = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", whole ? "true" : "false");
  document.querySelectorAll<HTMLElement>(".bracket-area").forEach((a) => {
    const inner = a.querySelector(".bracket-columns") as HTMLElement | null;
    if (whole) {
      a.style.overflow = "hidden";
      if (inner) {
        inner.style.transform = "scale(0.5)";
        inner.style.transformOrigin = "top left";
        inner.style.width = "max-content";
      }
      a.querySelectorAll<HTMLElement>(".match-card").forEach((c) => (c.style.width = "220px"));
    } else {
      a.style.overflow = "";
      if (inner) {
        inner.style.transform = "";
        inner.style.width = "";
      }
      a.querySelectorAll<HTMLElement>(".match-card").forEach((c) => (c.style.width = ""));
    }
  });
}

export function formatZoneTime(iso: string, zone: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function roundTitle(region: string, r: number): string {
  if (region === "winners") return `Winners round ${r}`;
  if (region === "losers") return `Losers round ${r}`;
  if (region === "final") return r === 1 ? "Grand final" : "Grand final reset";
  return `Round ${r}`;
}

export function currentRoundOf(matches: Match[], _t: Tournament): number {
  const open = (m: Match): boolean =>
    ["pending", "called", "reported", "disputed"].includes(m.state) &&
    m.upper !== null && m.lower !== null && !("bye" in m.upper) && !("bye" in m.lower);
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    if (matches.filter((m) => m.round === r).some(open)) return r;
  }
  return rounds[rounds.length - 1] ?? 1;
}

/** Arrow keys, Home and End move focus between match cards as published. */
function attachRegionKeys(region: HTMLElement, matches: Match[], view: CardView): void {
  void view;
  region.addEventListener("keydown", (ev) => {
    const target = document.activeElement as HTMLElement;
    const card = target.closest<HTMLElement>("[data-match-id]");
    if (!card || !region.contains(card)) return;
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft" && ev.key !== "ArrowUp" && ev.key !== "ArrowDown" && ev.key !== "Home" && ev.key !== "End") return;
    if (target.tagName === "INPUT") return;
    ev.preventDefault();
    const id = card.dataset.matchId!;
    const current = matches.find((m) => m.id === id);
    if (!current) return;
    const inRegion = matches.filter((m) => m.bracket === current.bracket);
    const byRound = new Map<number, Match[]>();
    for (const m of inRegion) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    const isDropIn = (r: number): boolean => current.bracket === "losers" && r % 2 === 0 && r >= 2;

    const nextInRound = (m: Match, forward: boolean): Match | undefined => {
      const list = byRound.get(m.round) ?? [];
      const idx = list.findIndex((x) => x.id === m.id);
      return list[idx + (forward ? 1 : -1)];
    };

    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const next = nextInRound(current, ev.key === "ArrowDown");
      if (next) focusCard(next.id);
      return;
    }
    if (ev.key === "Home") {
      const first = byRound.get(rounds[0]!)?.[0];
      if (first) focusCard(first.id);
      return;
    }
    if (ev.key === "End") {
      const lastRound = byRound.get(rounds[rounds.length - 1]!);
      const first = lastRound?.[0];
      if (first) focusCard(first.id);
      return;
    }
    if (ev.key === "ArrowRight") {
      if (current.bracket === "final" && current.round === 1) {
        const reset = inRegion.find((m) => m.round === 2);
        if (reset) focusCard(reset.id);
        return;
      }
      const targetRound = current.round + 1;
      const list = byRound.get(targetRound);
      if (!list || list.length === 0) return;
      let next: Match | undefined;
      if (current.bracket === "main" || current.bracket === "winners") {
        next = list[Math.ceil(current.number / 2) - 1];
      } else if (current.bracket === "losers") {
        next = isDropIn(targetRound) ? list[current.number - 1] : list[Math.ceil(current.number / 2) - 1];
      } else {
        next = list[Math.min(current.number - 1, list.length - 1)];
      }
      if (next) focusCard(next.id);
      return;
    }
    if (ev.key === "ArrowLeft") {
      if (current.bracket === "final" && current.round === 2) {
        const gf = inRegion.find((m) => m.round === 1);
        if (gf) focusCard(gf.id);
        return;
      }
      const targetRound = current.round - 1;
      if (targetRound < (rounds[0] ?? 1)) return;
      const list = byRound.get(targetRound);
      if (!list || list.length === 0) return;
      let next: Match | undefined;
      if (current.bracket === "main" || current.bracket === "winners") {
        next = list[2 * current.number - 1];
      } else if (current.bracket === "losers") {
        next = isDropIn(current.round) ? list[current.number - 1] : list[2 * current.number - 1];
      } else {
        next = list[Math.min(current.number - 1, list.length - 1)];
      }
      if (next) focusCard(next.id);
    }
  });
  // exactly one card in the Tab order: the last focused card, or the first match of the current round
  const cards = Array.from(region.querySelectorAll<HTMLElement>("[data-match-id]"));
  cards.forEach((c) => c.setAttribute("tabindex", "-1"));
  const last = document.querySelector<HTMLElement>(`[data-match-id="${lastFocusedId}"]`);
  if (last && region.contains(last)) last.setAttribute("tabindex", "0");
  else cards[0]?.setAttribute("tabindex", "0");
}

let lastFocusedId: string | null = null;

export function rememberFocus(id: string): void {
  lastFocusedId = id;
}

function phoneTabs(
  area: HTMLElement,
  data: PageData,
  isOrganizer: boolean,
  t: Tournament,
  _view: CardView
): HTMLElement {
  // one round at a time under tablist "Rounds", with swipe between rounds
  const cols: { label: string; col: HTMLElement }[] = [];
  const byLabel = new Map<string, string>();
  byLabel.set("Winners bracket", "Winners");
  byLabel.set("Losers bracket", "Losers");
  byLabel.set("Grand final", "Grand final");
  for (const region of Array.from(area.querySelectorAll<HTMLElement>(".bracket-region"))) {
    const regionLabel = region.getAttribute("aria-label") ?? "";
    for (const col of Array.from(region.querySelectorAll<HTMLElement>(".bracket-round"))) {
      const round = Number(col.dataset.round ?? 1);
      const prefix = byLabel.get(regionLabel) ?? "Round";
      cols.push({ label: prefix === "Grand final" ? (round === 1 ? "Grand final" : "Grand final reset") : `${prefix} ${round}`, col });
    }
  }
  if (cols.length === 0) return area;
  const host = el("div", { class: "stack" });
  const tabs = el("div", { class: "round-tabs", role: "tablist", attrs: { "aria-label": "Rounds", tabindex: "0" } });
  const panelHost = el("div", { class: "swipe-panel" });
  let selected = 0;
  // the selected tab on load holds the current round
  const current = currentRoundOf(data.matches, t);
  const currentLabel = data.matches.find((m) => m.round === current)?.bracket ?? "main";
  selected = Math.max(0, cols.findIndex((c) => c.col.querySelector(`[data-bracket="${currentLabel}"][data-round="${current}"]`) !== null));
  cols.forEach((_, i) => {
    tabs.appendChild(el("button", {
      class: "round-tab",
      role: "tab",
      ariaSelected: i === selected ? "true" : "false",
      attrs: { "aria-controls": `round-panel-${i}` },
      on: { click: () => { selected = i; repaint(); } },
    }, [cols[i]!.label]));
  });
  const repaint = (): void => {
    clear(panelHost);
    Array.from(tabs.children).forEach((c, i) => c.setAttribute("aria-selected", i === selected ? "true" : "false"));
    const col = cols[selected];
    if (!col) return;
    const panel = el("div", { role: "tabpanel", id: `round-panel-${selected}`, ariaLabel: col.label });
    for (const card of Array.from(col.col.querySelectorAll<HTMLElement>(".match-card"))) {
      const clone = card.cloneNode(true) as HTMLElement;
      const id = clone.dataset.matchId!;
      clone.addEventListener("click", () => {
        const m = data.matches.find((x) => x.id === id);
        if (m) openDialogFor(m, data, isOrganizer, clone, () => {});
      });
      clone.setAttribute("tabindex", "0");
      panel.appendChild(clone);
    }
    panelHost.appendChild(panel);
  };
  repaint();

  // swipe: at least 50px, more horizontal than vertical
  let startX = 0, startY = 0;
  panelHost.addEventListener("touchstart", (ev) => {
    const t0 = ev.touches[0]!;
    startX = t0.clientX;
    startY = t0.clientY;
  }, { passive: true });
  panelHost.addEventListener("touchend", (ev) => {
    const t1 = ev.changedTouches[0]!;
    const dx = t1.clientX - startX;
    const dy = t1.clientY - startY;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && selected < cols.length - 1) { selected += 1; repaint(); }
      else if (dx > 0 && selected > 0) { selected -= 1; repaint(); }
    }
  });
  tabs.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" && selected < cols.length - 1) { selected += 1; repaint(); }
    if (ev.key === "ArrowLeft" && selected > 0) { selected -= 1; repaint(); }
  });
  host.appendChild(tabs);
  host.appendChild(panelHost);
  return host;
}

