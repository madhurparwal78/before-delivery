import { api, jsonFetch, mountOutageBanner, loadingEl, el, avatarSvg, type Me } from "../lib/app.js";

interface HistoryMatch {
  matchId: string;
  mode: string;
  format: string;
  opponent: string;
  result: string;
  yourScore: number;
  theirScore: number;
  ratingDelta: number | null;
  endReason: string;
  endedAt: string;
}

const MODE_WORDS: Record<string, string> = {
  local: "Pass and play",
  private: "Private",
  casual: "Casual",
  ranked: "Ranked",
};

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
  const name = decodeURIComponent(window.location.pathname.split("/").pop() ?? "");
  const player = await jsonFetch<{
    id: string;
    name: string;
    avatar: number;
    rating: number;
    rd: number;
    tier: string;
    rankedGames: number;
  }>(`/api/players/by-name/${encodeURIComponent(name)}`);
  root.textContent = "";

  const page = el("div", { class: "page" });
  if (me !== null) {
    const bar = el("nav", { class: "top-bar" });
    bar.append(
      el("a", { href: `/profile/${encodeURIComponent(me.name)}` }, `${me.name} profile`),
      el("span", { class: "chip", id: "chalk-balance" }, `${me.chalk} chalk`),
      el("a", { href: "/shop" }, "Shop"),
      el("a", { href: "/leaderboard" }, "Leaderboard"),
      el("a", { href: "/" }, "Home")
    );
    page.appendChild(bar);
  }
  root.appendChild(page);

  if (player.status !== 200) {
    page.appendChild(el("h1", {}, "Player not found"));
    return;
  }

  const p = player.body;
  const header = el("header", { class: "profile-header" });
  header.appendChild(avatarSvg(p.avatar, 96));
  const h1 = el("h1", { class: "display", style: "font-size: 40px" }, p.name);
  const rating = el("p", { id: "rating" }, `${Math.round(p.rating)} ${p.tier}`);
  header.append(h1, rating);
  page.appendChild(header);

  const history = await jsonFetch<{ matches: HistoryMatch[] }>(`/api/players/${p.id}/history`);
  const list = el("ul", { class: "history-list", id: "match-history" });
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Match history");

  if (history.status === 200 && history.body.matches.length > 0) {
    for (const match of history.body.matches) {
      const row = el("li", { class: "history-row" });
      const word = el("span", { class: "history-word" }, match.result === "won" ? "WON" : "LOST");
      const mode = el("span", {}, MODE_WORDS[match.mode] ?? match.mode);
      const format = el("span", {}, match.format === "quick" ? "Quick" : "Classic");
      const opponent = el("span", {}, `vs ${match.opponent}`);
      const score = el("span", { class: "num" }, `${match.yourScore}-${match.theirScore}`);
      const delta = el("span", { class: "num" },
        match.ratingDelta === null
          ? ""
          : `${match.ratingDelta >= 0 ? "+" : ""}${Math.round(match.ratingDelta)}`);
      row.append(word, mode, format, opponent, score, delta);
      list.appendChild(row);
    }
  } else {
    const empty = el("li", { class: "empty-state" });
    const word = el("span", { class: "cropped-word", style: "font-size: 18vw" }, "NO MATCHES YET");
    const link = el("a", { class: "btn btn-primary", href: "/" }, "Play your first match");
    empty.append(word, link);
    list.appendChild(empty);
  }
  page.appendChild(list);
}

void main();
