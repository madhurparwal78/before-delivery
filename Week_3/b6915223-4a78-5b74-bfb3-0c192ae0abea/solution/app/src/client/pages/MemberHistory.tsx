import { useEffect, useState } from "preact/hooks";
import type { CataloguePlayer, HistoryView } from "../../shared/api.ts";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { HistoryTable } from "../components/HistoryTable.tsx";
import { useLive } from "../live.ts";
import { linkClick } from "../router.ts";

// One league member's gameweek history, with their stored snapshots (brief: Member history).
export function MemberHistoryPage({ leagueId, managerId }: { leagueId: string; managerId: string }) {
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [missing, setMissing] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [updates, announce] = useAnnouncer();
  const base = `/api/leagues/${leagueId}/members/${managerId}`;

  const load = async () => {
    const result = await request<HistoryView>("GET", `${base}/history`);
    if (result.ok) setHistory(result.data);
    else setMissing(true);
  };
  useEffect(() => {
    void load();
    void request<{ players: CataloguePlayer[] }>("GET", "/api/players").then((result) => {
      if (result.ok) setNames(new Map(result.data.players.map((player) => [player.id, player.name])));
    });
  }, []);
  useLive((message) => {
    if (message.t === "gameweek" || message.t === "receipt" || message.t === "event") void load();
  });

  return (
    <main class="wide">
      <a class="back-link" href={`/leagues/${leagueId}`} onClick={(event) => linkClick(event, `/leagues/${leagueId}`)}>
        Back to the league
      </a>
      <div class="page-head">
        <h1>{history ? history.team_name : "Member history"}</h1>
        {history && <p class="mono">Season total {history.season_total}</p>}
      </div>
      <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="History updates">
        {updates.text}
      </p>
      {missing ? (
        <p class="empty-note">This manager is not in that league.</p>
      ) : history ? (
        <HistoryTable rows={history.rows} playerName={(id) => names.get(id) ?? id} snapshotUrl={(gameweek) => `${base}/snapshots/${gameweek}`} announce={announce} />
      ) : (
        <p class="loading">Loading history…</p>
      )}
    </main>
  );
}
