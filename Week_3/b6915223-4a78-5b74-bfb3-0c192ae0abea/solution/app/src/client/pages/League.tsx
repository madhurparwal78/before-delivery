import { useEffect, useState } from "preact/hooks";
import type { LeagueDetail } from "../../shared/api.ts";
import { request } from "../api.ts";
import { useAnnouncer } from "../announce.ts";
import { CopyIcon, RefreshIcon } from "../components/Icons.tsx";
import { LeagueTable } from "../components/LeagueTable.tsx";
import { useLive } from "../live.ts";
import { linkClick } from "../router.ts";
import { useApp } from "../store.ts";

// One league: the standings, and for the admin the join code (brief: Screens / League).
export function LeaguePage({ leagueId }: { leagueId: string }) {
  const { me } = useApp();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [updates, announce] = useAnnouncer();

  const load = async () => {
    const result = await request<LeagueDetail>("GET", `/api/leagues/${leagueId}`);
    if (result.ok) setLeague(result.data);
    else setMissing(true);
  };
  useEffect(() => void load(), []);
  useLive((message) => {
    if (message.t === "gameweek" || message.t === "event" || message.t === "league") void load();
  });

  const copy = async () => {
    if (!league?.code) return;
    await navigator.clipboard.writeText(league.code);
    announce(`Join code ${league.code} copied.`);
  };
  const replace = async () => {
    setReplacing(true);
    const result = await request<{ code: string }>("POST", `/api/leagues/${leagueId}/code`);
    setReplacing(false);
    if (result.ok) {
      setLeague((current) => (current ? { ...current, code: result.data.code } : current));
      announce(`New join code ${result.data.code}. The old code no longer works.`);
    } else {
      announce(result.error.message, true);
    }
  };

  if (missing) {
    return (
      <main class="wide">
        <h1>League</h1>
        <p class="empty-note">No league of yours has that address.</p>
      </main>
    );
  }
  return (
    <main class="wide">
      <a class="back-link" href="/leagues" onClick={(event) => linkClick(event, "/leagues")}>
        All leagues
      </a>
      <div class="page-head">
        <h1>{league?.name ?? "League"}</h1>
        {league && <p class="mono">Gameweek {league.gameweek}</p>}
      </div>
      <p class={`updates result-strip${updates.error ? " is-error" : ""}`} role="status" aria-label="League updates">
        {updates.text}
      </p>
      {league?.code && (
        <section class="section panel" aria-label="Join code">
          <span class="label">Join code</span>
          <div class="form-row button-row code-row">
            <span class="code">{league.code}</span>
            <button type="button" class="btn" onClick={() => void copy()}>
              <CopyIcon />
              Copy join code
            </button>
            <button type="button" class="btn" disabled={replacing} onClick={() => void replace()}>
              <RefreshIcon />
              {replacing ? "Replacing…" : "New join code"}
            </button>
          </div>
        </section>
      )}
      {league ? (
        <LeagueTable name="Standings" rows={league.standings} me={me?.id ?? null} move={0} memberLink={(id) => `/leagues/${leagueId}/members/${id}`} />
      ) : (
        <p class="loading">Loading standings…</p>
      )}
    </main>
  );
}
