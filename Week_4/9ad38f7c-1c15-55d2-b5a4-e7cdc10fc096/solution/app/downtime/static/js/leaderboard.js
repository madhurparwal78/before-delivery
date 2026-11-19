// The live leaderboard: server-paged, its page kept in the address as `board`, refreshed by score events.
import { $, OUTAGE, api, icon, isOutage, reducedMotion, utcText } from "./common.js";
import { announce } from "./dialog.js";

const VALID_BOARD = /^[1-9][0-9]*$/;
const SHOW_ALL_PAGES = 7;

/** The page buttons to show: every page up to seven, else first, last, current and neighbours with gaps. */
function pageLabels(current, pages) {
  const all = Array.from({ length: pages }, (_, i) => i + 1);
  if (pages <= SHOW_ALL_PAGES) return all;
  const shown = all.filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1);
  const labels = [];
  let previous = 0;
  for (const n of shown) {
    if (n - previous > 2) labels.push("…");
    else if (n - previous === 2) labels.push(n - 1);
    labels.push(n);
    previous = n;
  }
  return labels;
}

function status(word) {
  const done = word === "Passed" || word === "Completed";
  const span = document.createElement("span");
  span.className = done ? "status is-done" : "status";
  span.append(...(done ? [icon("tick"), word] : [word]));
  return span;
}

function cell(className, ...content) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.append(...content);
  return td;
}

export function wireLeaderboard(scenarioTitles) {
  const tbody = $("[data-board-rows]");
  const pagesEl = $("[data-pages]");
  const prev = $("[data-prev]");
  const next = $("[data-next]");
  const count = $("[data-page-count]");
  const region = $("[data-board-region]");
  const feed = $("[data-feed]");
  const rows = new Map();
  let shown = { page: 1, pages: 1 };

  function addressPage() {
    const value = new URLSearchParams(window.location.search).get("board");
    if (value === null) return { page: 1, normalise: false };
    if (!VALID_BOARD.test(value) || value === "1") return { page: 1, normalise: true };
    return { page: Math.min(Number(value), Number.MAX_SAFE_INTEGER), normalise: false };
  }

  function writeAddress(page, how) {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete("board");
    else url.searchParams.set("board", String(page));
    window.history[how](window.history.state, "", url);
  }

  function renderRows(entries) {
    const before = new Map([...rows].map(([id, tr]) => [id, tr.getBoundingClientRect().top]));
    rows.clear();
    tbody.replaceChildren(...entries.map((entry) => {
      const tr = before.has(entry.team_id) ? tbody.querySelector(`tr[data-team="${entry.team_id}"]`) : document.createElement("tr");
      tr.dataset.team = String(entry.team_id);
      tr.className = `rank-${entry.rank}`;
      const points = document.createElement("strong");
      points.textContent = String(entry.points);
      tr.replaceChildren(
        cell("rank", String(entry.rank)),
        cell("team-cell", entry.team_name),
        cell("sim", status(entry.soc_sim)),
        cell("sim", status(entry.th_sim)),
        cell("sim", status(entry.tabletop)),
        cell("", `${entry.challenges_solved}/${entry.challenges_total}`),
        cell("num pts", points, " XP"),
      );
      rows.set(entry.team_id, tr);
      return tr;
    }));
    if (reducedMotion.matches) return;
    for (const [id, tr] of rows) {
      const shift = (before.get(id) ?? tr.getBoundingClientRect().top) - tr.getBoundingClientRect().top;
      if (Math.abs(shift) > 1) {
        tr.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], { duration: 330, easing: "linear" });
      }
    }
  }

  function renderPager(page, pages) {
    const hadFocus = pagesEl.contains(document.activeElement);
    pagesEl.replaceChildren(...pageLabels(page, pages).map((label) => {
      if (label === "…") {
        const gap = document.createElement("span");
        gap.className = "pager-gap";
        gap.textContent = "…";
        return gap;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(label);
      if (label === page) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => go(label));
      return button;
    }));
    if (hadFocus) $("[aria-current='page']", pagesEl)?.focus();
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    count.textContent = `${page} of ${pages} available pages`;
  }

  function renderFeed(items) {
    feed.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      const line = document.createElement("span");
      line.className = "feed-line";
      line.textContent = `${item.team_name} solved ${item.scenario_title}`;
      const meta = document.createElement("span");
      meta.className = "feed-time";
      const points = document.createElement("span");
      points.className = "feed-points";
      points.textContent = `+${item.points} XP`;
      meta.append(points, ` · ${utcText(item.created_at)}`);
      li.append(line, meta);
      return li;
    }));
  }

  async function load(page) {
    const result = await api(`/api/leaderboard?page=${page}&include_feed=1`);
    if (result.status !== 200) {
      announce(region, OUTAGE, isOutage(result) ? "outage" : "error");
      return;
    }
    const data = result.data;
    if (!data.entries.length && data.pages >= 1 && page > data.pages) {
      writeAddress(data.pages, "replaceState");
      await load(data.pages);
      return;
    }
    shown = { page: data.page, pages: data.pages };
    renderRows(data.entries);
    renderPager(data.page, data.pages);
    renderFeed(data.feed);
    if (region.classList.contains("is-outage") || region.textContent === "Loading leaderboard…") announce(region, "");
  }

  function go(page) {
    if (page === shown.page) return;
    writeAddress(page, "pushState");
    load(page);
  }

  prev.addEventListener("click", () => go(shown.page - 1));
  next.addEventListener("click", () => go(shown.page + 1));
  // Back and Forward keep focus where it was; a fragment in the address would otherwise clear it.
  let lastFocused = null;
  document.addEventListener("focusin", (event) => { lastFocused = event.target; });
  window.addEventListener("popstate", async () => {
    const keep = lastFocused;
    const { page, normalise } = addressPage();
    if (normalise) writeAddress(1, "replaceState");
    await load(page);
    if (keep?.isConnected && document.activeElement !== keep) keep.focus({ preventScroll: true });
  });

  const { page, normalise } = addressPage();
  if (normalise) writeAddress(1, "replaceState");
  load(page);

  return {
    /** A team solve anywhere: reload the page shown, announce the line, keep the address. */
    scored(event) {
      announce(region, `${event.team_name} solved ${scenarioTitles.get(event.scenario_slug) ?? event.scenario_slug}`);
      load(shown.page);
    },
    reconnected() {
      load(shown.page);
    },
    lost() {
      announce(region, OUTAGE, "outage");
    },
  };
}
