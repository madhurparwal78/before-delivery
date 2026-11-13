import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { Bean, usePending } from "./ui";
import type { MatchView, ProfileView } from "./types";

export function ProfilePage({ handle, embedded = false }: { handle: string; embedded?: boolean }): JSX.Element {
  const [view, setView] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [busy, run] = usePending();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.get<ProfileView>(`/api/users/${encodeURIComponent(handle)}`);
        if (!cancelled) setView(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => store.subscribe(() => setTick((n) => n + 1)), []);

  if (error) {
    return (
      <div className={embedded ? "" : "page"}>
        <p>{error}</p>
      </div>
    );
  }
  if (!view) return <div className={embedded ? "" : "page"}>Loading…</div>;

  const friendship = view.friendship;

  const addFriend = run(async () => {
    try {
      await api.post("/api/friends/requests", { handle: view.user.handle });
      store.notify(`Friend request sent to ${view.user.handle}.`, "success");
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const block = run(async () => {
    try {
      await api.post("/api/blocks", { userId: view.user.id });
      store.notify(`${view.user.handle} is blocked.`, "success");
      await store.refreshFriends();
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const unblock = run(async () => {
    try {
      await api.del(`/api/blocks/${view.user.id}`);
      store.notify(`${view.user.handle} is unblocked.`, "success");
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const removeFriend = run(async () => {
    try {
      await api.del(`/api/friends/${view.user.id}`);
      store.notify(`${view.user.handle} removed from friends.`, "success");
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <div className={embedded ? "" : "page"}>
      <div className="profile-head">
        <Bean userId={view.user.id} size={96} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: "anywhere" }}>{view.user.handle.toLowerCase()}</h1>
          <p className="profile-counts" style={{ margin: "6px 0 0" }}>
            Matches played: <span className="num">{view.played}</span>
            <br />
            Wins: <span className="num">{view.wins}</span>
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {friendship === "none" && (
          <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => void addFriend()}>
            Add friend
          </button>
        )}
        {friendship === "friends" && (
          <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void removeFriend()}>
            Remove {view.user.handle} from friends
          </button>
        )}
        {friendship === "blocked" && (
          <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void unblock()}>
            Unblock {view.user.handle}
          </button>
        )}
        {friendship !== "blocked" && friendship !== "blocked_by" && (
          <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void block()}>
            Block {view.user.handle}
          </button>
        )}
      </div>
      {friendship === "blocked_by" && <p style={{ color: "var(--ink-soft)" }}>You can't view this player.</p>}

      <section aria-label="Match history">
        <h3>Match history</h3>
        <ul className="match-history">
          {view.matches.map((match) => (
            <li key={match.id}>
              <a className="match-link" href={`#/matches/${match.id}`}>
                <span>Cup #{match.id}</span>
                <span style={{ fontWeight: 700 }}>
                  {match.outcome === "winner" ? "Winner" : `Out in ${roundNameOf(match.round)}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {view.matches.length === 0 && <p style={{ color: "var(--ink-soft)" }}>No finished matches yet.</p>}
      </section>
    </div>
  );
}

function roundNameOf(round: number | null): string {
  if (round === null) return "the cup";
  return ["Wobble Dash", "Sweeper Spin", "Crown Climb"][round - 1] ?? "the cup";
}

export function MatchSummaryPage({ matchId, embedded = false }: { matchId: number; embedded?: boolean }): JSX.Element {
  const [match, setMatch] = useState<MatchView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await api.get<{ match: MatchView }>(`/api/matches/${matchId}`);
        if (!cancelled) setMatch(view.match);
      } catch {
        // match may be missing
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (!match) return <div className={embedded ? "" : "page"}>Loading…</div>;

  return (
    <div className={embedded ? "" : "page"}>
      <h1>Cup #{match.id}</h1>
      <p style={{ color: "var(--ink-soft)" }}>
        {match.state === "finished" ? "Finished" : "Running"} · {match.participants.length} players
        {match.winnerId !== null && <> · Winner: {match.participants.find((p) => p.id === match.winnerId)?.handle}</>}
      </p>
      <ul className="match-history" aria-label="Rounds">
        {match.rounds.map((round) => (
          <li key={round.n} className="panel" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              <strong>
                Round {round.n}: {round.name}
              </strong>
              <br />
              <span style={{ color: "var(--ink-soft)" }}>
                {round.kind} · seed <span className="num">{round.seed}</span> · starters <span className="num">{round.starters.length}</span> · slots{" "}
                <span className="num">{round.slots}</span> · qualified <span className="num">{round.results.filter((r) => r.outcome === "qualified").length}</span>
              </span>
            </span>
            {round.state === "resolved" && (
              <a className="btn btn-small" href={`#/matches/${match.id}/rounds/${round.n}`}>
                Photo-finish: {round.name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
