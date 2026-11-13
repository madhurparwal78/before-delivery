import { ApiFail, get } from "../api";
import { h } from "../dom";
import type { Mount } from "../router";
import { avatarArt } from "../ui/avatar";
import { deniedPage, topBar } from "../ui/shell";

interface PlayerView {
  id: string;
  name: string;
  avatar: number;
  rating: number;
  tier: string;
  rankedGames: number;
}

interface HistoryRow {
  matchId: string;
  mode: "local" | "private" | "casual" | "ranked";
  format: "quick" | "classic";
  opponent: string;
  result: "won" | "lost";
  yourScore: number;
  theirScore: number;
  ratingDelta: number | null;
}

const MODE_WORDS: Record<HistoryRow["mode"], string> = { local: "Pass and play", private: "Private", casual: "Casual", ranked: "Ranked" };

function signed(delta: number): string {
  const whole = Math.round(delta);
  return whole > 0 ? `+${whole}` : String(whole);
}

const profile: Mount = async ({ root, params }) => {
  let player: PlayerView;
  let rows: HistoryRow[];
  try {
    player = await get<PlayerView>(`/api/players/by-name/${encodeURIComponent(params[0] ?? "")}`);
    rows = (await get<{ matches: HistoryRow[] }>(`/api/players/${player.id}/history`)).matches;
  } catch (error) {
    root.replaceChildren(deniedPage(error instanceof ApiFail && error.status === 404 ? "Player not found" : "Online play is unavailable right now."));
    return undefined;
  }
  const history = rows.length
    ? h(
        "ul",
        { class: "history", "aria-label": "Match history" },
        ...rows.map((row) =>
          h(
            "li",
            { class: `history-row ${row.result}` },
            h("span", { class: "history-result" }, row.result === "won" ? "WON" : "LOST"),
            h(
              "span",
              { class: "history-detail" },
              h("span", { class: "history-mode" }, MODE_WORDS[row.mode], " · ", row.format === "classic" ? "Classic" : "Quick"),
              h("span", { class: "history-vs" }, `vs ${row.opponent}`),
              h("span", { class: "history-score" }, `${row.yourScore}-${row.theirScore}`),
              row.ratingDelta === null ? null : h("span", { class: "history-delta" }, signed(row.ratingDelta)),
            ),
          ),
        ),
      )
    : h(
        "div",
        { class: "empty" },
        h("p", { class: "giant", "aria-hidden": "true" }, "NO MATCHES YET"),
        h("span", { class: "sr-only" }, "No matches yet"),
        h("a", { href: "/", class: "btn btn-ink" }, "Play your first match"),
      );
  root.replaceChildren(
    h(
      "div",
      { class: "working" },
      topBar(true),
      h(
        "div",
        { class: "working-body" },
        h(
          "div",
          { class: "profile-head" },
          h("span", { class: "profile-avatar" }, avatarArt(player.avatar)),
          h("div", {}, h("h1", { class: "page-title", tabindex: -1 }, player.name), h("p", { id: "rating", class: "rating" }, `${Math.round(player.rating)} ${player.tier}`)),
        ),
        h("h2", { class: "section-title" }, "Match history"),
        history,
      ),
    ),
  );
  return undefined;
};

export default profile;
