import { get } from "../api";
import { h } from "../dom";
import type { Mount } from "../router";
import { topBar } from "../ui/shell";

interface Row {
  rank: number;
  playerId: string;
  name: string;
  rating: number;
  tier: string;
}

const leaderboard: Mount = async ({ root }) => {
  const board = await get<{ rows: Row[]; you: Row | null }>("/api/leaderboard").catch(() => ({ rows: [] as Row[], you: null }));
  const cells = (row: Row): HTMLElement[] => [
    h("td", {}, row.rank),
    h("td", {}, h("a", { href: `/profile/${encodeURIComponent(row.name)}` }, row.name)),
    h("td", { class: "num" }, Math.round(row.rating)),
    h("td", {}, row.tier),
  ];
  const table = h(
    "table",
    { class: "board-table", "aria-label": "Leaderboard" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Rank"), h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, "Rating"), h("th", { scope: "col" }, "Tier"))),
    h("tbody", {}, ...board.rows.map((row) => h("tr", {}, ...cells(row)))),
  );
  root.replaceChildren(
    h(
      "div",
      { class: "working" },
      topBar(true),
      h(
        "div",
        { class: "working-body" },
        h("h1", { class: "page-title", tabindex: -1 }, "Leaderboard"),
        h("p", { class: "meta" }, "Ten ranked matches and a settled rating put a player on the board."),
        board.rows.length ? table : null,
        board.rows.length
          ? null
          : h(
              "div",
              { class: "empty" },
              h("p", { class: "giant", "aria-hidden": "true" }, "NO RANKS YET"),
              h("span", { class: "sr-only" }, "No ranks yet"),
              h("a", { href: "/", class: "btn btn-ink" }, "Play ranked"),
            ),
        board.you
          ? h("div", { class: "you-row" }, h("span", {}, "You"), h("span", { class: "num" }, `#${board.you.rank}`), h("span", {}, board.you.name), h("span", { class: "num" }, Math.round(board.you.rating)), h("span", {}, board.you.tier))
          : null,
      ),
    ),
  );
  return undefined;
};

export default leaderboard;
