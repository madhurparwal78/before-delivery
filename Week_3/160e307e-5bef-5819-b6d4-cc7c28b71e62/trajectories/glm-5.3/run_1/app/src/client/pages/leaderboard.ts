import { api, jsonFetch, mountOutageBanner, loadingEl, el, type Me } from "../lib/app.js";

interface LeaderRow {
  rank: number;
  playerId: string;
  name: string;
  rating: number;
  tier: string;
  rankedGames: number;
}

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  const res = await jsonFetch<{ rows: LeaderRow[]; you: LeaderRow | null }>("/api/leaderboard");
  root.textContent = "";

  const page = el("div", { class: "page" });
  if (me !== null) {
    const bar = el("nav", { class: "top-bar" });
    bar.append(
      el("a", { href: `/profile/${encodeURIComponent(me.name)}` }, `${me.name} profile`),
      el("span", { class: "chip", id: "chalk-balance" }, `${me.chalk} chalk`),
      el("a", { href: "/shop" }, "Shop"),
      el("a", { href: "/" }, "Home")
    );
    page.appendChild(bar);
  }
  const h1 = el("h1", { class: "display", style: "font-size: 40px" }, "Leaderboard");
  page.appendChild(h1);
  root.appendChild(page);

  if (res.status !== 200) {
    page.appendChild(el("p", {}, "The leaderboard is unavailable right now."));
    return;
  }

  const table = el("table", { id: "leaderboard-table" });
  table.setAttribute("aria-label", "Leaderboard");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["Rank", "Name", "Rating", "Tier"]) {
    headRow.appendChild(el("th", { scope: "col" }, label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of res.body.rows) {
    const tr = el("tr");
    tr.append(
      el("td", { class: "num" }, String(row.rank)),
      el("td", {}, row.name),
      el("td", { class: "num" }, String(Math.round(row.rating))),
      el("td", {}, row.tier)
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  page.appendChild(table);

  if (res.body.you !== null) {
    const you = res.body.you;
    const own = el("table", { class: "own-row" });
    own.setAttribute("aria-label", "Your row");
    const tr = el("tr");
    tr.append(
      el("td", { class: "num" }, String(you.rank)),
      el("td", {}, you.name),
      el("td", { class: "num" }, String(Math.round(you.rating))),
      el("td", {}, you.tier)
    );
    own.appendChild(tr);
    page.appendChild(own);
  }
}

void main();
