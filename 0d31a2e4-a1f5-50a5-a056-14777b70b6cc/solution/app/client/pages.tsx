// The profile and match summary pages.
import { useEffect, useState } from "preact/hooks";
import { ApiFailure, get, post, remove } from "./api.js";
import { Bean } from "./bean.js";
import { COPY, PRESENCE_TEXT } from "./copy.js";
import { announce, announceFailure } from "./notices.js";
import { me, refreshFriends } from "./state.js";
import { useStore } from "./store.js";
import { ActionButton } from "./ui.js";
import type { Match, Profile } from "../shared/api.js";
import { kindSpec, roundSpec } from "../shared/rules.js";

function useLoad<T>(path: string): [T | null | "missing", () => Promise<void>] {
  const [value, setValue] = useState<T | null | "missing">(null);
  const load = async (): Promise<void> => {
    try {
      setValue(await get<T>(path));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setValue("missing");
      else announceFailure(error);
    }
  };
  useEffect(() => {
    setValue(null);
    void load();
  }, [path]);
  return [value, load];
}

function placementText(entry: Profile["matches"][number]): string {
  return entry.outcome === "winner" ? "Winner" : `Out in ${entry.round === null ? "" : roundSpec(entry.round)?.name ?? ""}`;
}

export function ProfilePage({ handle }: { handle: string }) {
  const self = useStore(me);
  const [profile, reload] = useLoad<Profile>(`/api/users/${encodeURIComponent(handle)}`);
  if (profile === null) return <section class="page card"><p>Loading profile…</p></section>;
  if (profile === "missing") return <section class="page card"><h1>No such player</h1><p>There is no player called {handle}.</p></section>;
  const { user, friendship } = profile;
  const isSelf = self?.id === user.id;
  const refresh = async () => {
    await reload();
    if (self?.emailVerified) await refreshFriends();
  };
  const actions = [];
  if (!isSelf && (friendship === "none" || friendship === "pending_in")) {
    actions.push(<ActionButton key="add" label="Add friend" kind="primary" run={async () => {
      try {
        const result = await post<{ friendship?: unknown }>("/api/friends/requests", { handle: user.handle });
        announce(result.friendship === undefined ? COPY.requestSent(user.handle) : COPY.nowFriends(user.handle));
        await refresh();
      } catch (error) {
        announceFailure(error, { blocked: COPY.cantAdd, already_friends: COPY.alreadyFriends(user.handle) });
      }
    }} />);
  }
  if (!isSelf && friendship === "pending_out") actions.push(<p key="sent" class="note">Friend request sent</p>);
  if (!isSelf && friendship === "friends") {
    actions.push(<ActionButton key="remove" label={`Remove ${user.handle} from friends`} run={async () => {
      try {
        await remove(`/api/friends/${user.id}`);
        announce(COPY.removed(user.handle));
        await refresh();
      } catch (error) {
        announceFailure(error);
      }
    }} />);
  }
  if (!isSelf && friendship !== "blocked") {
    actions.push(<ActionButton key="block" label={`Block ${user.handle}`} run={async () => {
      try {
        await post("/api/blocks", { userId: user.id });
        announce(COPY.blocked(user.handle));
        await refresh();
      } catch (error) {
        announceFailure(error);
      }
    }} />);
  }
  if (!isSelf && friendship === "blocked") {
    actions.push(<ActionButton key="unblock" label={`Unblock ${user.handle}`} run={async () => {
      try {
        await remove(`/api/blocks/${user.id}`);
        announce(COPY.unblocked(user.handle));
        await refresh();
      } catch (error) {
        announceFailure(error);
      }
    }} />);
  }
  return (
    <section class="page profile">
      <div class="card profile-head">
        <Bean userId={user.id} size={160} class="profile-bean" />
        <div>
          <h1>{user.handle}</h1>
          <p class="counts"><span>Matches played: <span class="numeric">{profile.played}</span></span><span>Wins: <span class="numeric">{profile.wins}</span></span></p>
          {profile.presence === null ? null : <p class="note">{PRESENCE_TEXT[profile.presence]}</p>}
          <div class="actions">{actions}</div>
        </div>
      </div>
      <section class="card" aria-labelledby="history-title">
        <h2 id="history-title">Match history</h2>
        <ul aria-label="Match history" class="history">
          {profile.matches.map((entry) => (
            <li key={entry.id}>
              <a href={`/matches/${entry.id}`}>{entry.name}</a>
              <span class={`placement ${entry.outcome}`}>{placementText(entry)}</span>
              <time class="numeric" dateTime={entry.finishedAt}>{new Date(entry.finishedAt).toLocaleDateString()}</time>
            </li>
          ))}
        </ul>
        {profile.matches.length === 0 ? <p class="empty">No finished matches yet.</p> : null}
      </section>
    </section>
  );
}

export function MatchPage({ matchId }: { matchId: number }) {
  const [body] = useLoad<{ match: Match }>(`/api/matches/${matchId}`);
  if (body === null) return <section class="page card"><p>Loading match…</p></section>;
  if (body === "missing") return <section class="page card"><h1>No such match</h1></section>;
  const { match } = body;
  const handles = new Map(match.participants.map((user) => [user.id, user.handle]));
  const winner = match.winnerId === null ? null : handles.get(match.winnerId) ?? null;
  return (
    <section class="page match-summary">
      <div class="card">
        <h1 class="display">{match.name}</h1>
        <p class="note">
          {match.state === "finished" ? (winner === null ? "Finished with no winner." : `Won by ${winner}.`) : "Still running."}
        </p>
      </div>
      {match.rounds.map((round) => {
        const qualified = round.results.filter((result) => result.outcome === "qualified").map((result) => handles.get(result.userId) ?? "");
        return (
          <section key={round.n} class="card round-card" aria-labelledby={`round-${round.n}`}>
            <h2 id={`round-${round.n}`}>{round.name}</h2>
            <dl class="facts">
              <div><dt>Kind</dt><dd>{kindSpec(round.kind).kindLabel}</dd></div>
              <div><dt>Seed</dt><dd class="numeric">{round.seed}</dd></div>
              <div><dt>Starters</dt><dd class="numeric">{round.starters.length}</dd></div>
              <div><dt>Slots</dt><dd class="numeric">{round.slots}</dd></div>
            </dl>
            <p><span class="label">Qualified:</span> {qualified.length === 0 ? "nobody" : qualified.join(", ")}</p>
            {round.state === "resolved" ? <a class="button secondary" href={`/matches/${match.id}/rounds/${round.n}`}>Photo-finish: {round.name}</a> : null}
          </section>
        );
      })}
    </section>
  );
}
