import { useLayoutEffect, useRef } from "preact/hooks";
import type { Standing } from "../../shared/api.ts";
import { linkClick } from "../router.ts";
import { ArrowIcon } from "./Icons.tsx";

// Standings rows carry data-manager-id, data-rank and data-points (season total). On a relay the
// viewer's row slides to its new rank (brief: Points relay stage 4).
function RankArrow({ rank, lastRank }: { rank: number; lastRank: number | null }) {
  if (lastRank === null || lastRank === rank) return null;
  const up = rank < lastRank;
  const places = Math.abs(lastRank - rank);
  return (
    <span class={`arrow ${up ? "up" : "down"}`} role="img" aria-label={`${up ? "Up" : "Down"} ${places}`}>
      <ArrowIcon up={up} />
      {places}
    </span>
  );
}

export function LeagueTable(props: {
  name: "League table" | "Standings";
  rows: Standing[];
  me: string | null;
  move: number;
  memberLink?: (managerId: string) => string;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const tops = useRef(new Map<string, number>());
  const lastMove = useRef(props.move);

  useLayoutEffect(() => {
    const rows = [...(body.current?.querySelectorAll<HTMLElement>("tr[data-manager-id]") ?? [])];
    const animate = props.move !== lastMove.current && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    lastMove.current = props.move;
    const next = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.managerId!;
      const top = row.getBoundingClientRect().top;
      next.set(id, top);
      const before = tops.current.get(id);
      if (animate && before !== undefined && before !== top) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], {
          duration: 330,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    tops.current = next;
  });

  return (
    <div class="table-frame" tabIndex={0} role="region" aria-label={`${props.name}, scrollable`}>
      <table class="league-table" aria-label={props.name}>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Team</th>
            <th scope="col" class="num">
              GW
            </th>
            <th scope="col" class="num">
              Total
            </th>
          </tr>
        </thead>
        <tbody ref={body}>
          {props.rows.map((row) => (
            <tr
              key={row.manager_id}
              class={`${row.manager_id === props.me ? "is-me" : ""}${props.memberLink ? " control-row" : ""}`}
              data-manager-id={row.manager_id}
              data-rank={String(row.rank)}
              data-points={String(row.season_total)}
            >
              <td>
                <span class="rank-cell mono">
                  {row.rank} <RankArrow rank={row.rank} lastRank={row.last_rank} />
                </span>
              </td>
              <td>
                {props.memberLink ? (
                  <a href={props.memberLink(row.manager_id)} onClick={(event) => linkClick(event, props.memberLink!(row.manager_id))}>
                    {row.team_name}
                  </a>
                ) : (
                  row.team_name
                )}
              </td>
              <td class="num">{row.gameweek_points}</td>
              <td class="num">{row.season_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
