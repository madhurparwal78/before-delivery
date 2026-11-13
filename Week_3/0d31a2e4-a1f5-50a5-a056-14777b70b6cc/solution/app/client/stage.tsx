// The stage: one view at a time, chosen by the party's state — party, lobby, match or results.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { get, post } from "./api.js";
import { Bean } from "./bean.js";
import { Bob } from "./bob.js";
import { COPY } from "./copy.js";
import { followMatch, leaveMatch, live } from "./live.js";
import { MatchView, ResultBanner } from "./match-view.js";
import { announce, announceFailure } from "./notices.js";
import { applyParty, invites, lobby, me, party, refreshParty, results } from "./state.js";
import { useStore } from "./store.js";
import { ActionButton, prefersReducedMotion } from "./ui.js";
import type { Match, Party } from "../shared/api.js";
import { LOBBY_SIZE } from "../shared/rules.js";

const BUSY = {
  party_full: COPY.partyFull, party_busy: COPY.partyBusy, not_leader: COPY.leaderOnly, not_friends: COPY.friendsOnly,
  invite_not_found: COPY.inviteClosed,
};

function PartyInvites() {
  const view = useStore(invites);
  if (view.incoming.length === 0) return null;
  return (
    <section role="region" aria-label="Party invites" class="card invites">
      <h2>Party invites</h2>
      <ul class="people">
        {view.incoming.map((invite) => (
          <li key={invite.id} class="person" data-user-id={invite.from.id}>
            <Bean userId={invite.from.id} />
            <div class="person-name"><span class="handle">{invite.from.handle}</span><span class="note">invited you</span></div>
            <div class="person-actions">
              <ActionButton label={`Join ${invite.from.handle}'s party`} kind="primary" run={async () => {
                try {
                  const { party: joined } = await post<{ party: Party }>(`/api/party/invites/${invite.id}/accept`);
                  applyParty(joined);
                  announce(COPY.joined(invite.from.handle));
                  await refreshParty();
                } catch (error) {
                  announceFailure(error, BUSY);
                  await refreshParty();
                }
              }} />
              <ActionButton label="Decline" ariaLabel={`Decline invite from ${invite.from.handle}`} kind="quiet" run={async () => {
                try {
                  await post(`/api/party/invites/${invite.id}/decline`);
                  announce(COPY.inviteDeclined);
                  await refreshParty();
                } catch (error) {
                  announceFailure(error, { invite_not_found: COPY.inviteClosed });
                }
              }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function leaveParty(): Promise<void> {
  try {
    const { party: solo } = await post<{ party: Party }>("/api/party/leave");
    applyParty(solo);
    announce(COPY.leftParty);
    await refreshParty();
  } catch (error) {
    announceFailure(error, { party_busy: COPY.partyBusy });
  }
}

function LeavePartyButton({ current }: { current: Party }) {
  if (current.members.length < 2) return null;
  return <ActionButton label="Leave party" kind="quiet" run={leaveParty} />;
}

function PartyView({ current, selfId }: { current: Party; selfId: number }) {
  const leading = current.leaderId === selfId;
  const leader = current.members.find((member) => member.user.id === current.leaderId);
  return (
    <section role="region" aria-label="Party" class="card party-card">
      <h2>Your party</h2>
      <ul aria-label="Party members" class="party-members">
        {current.members.map(({ user }, index) => (
          <li key={user.id} data-user-id={user.id} data-leader={user.id === current.leaderId ? "true" : undefined} class="member">
            <Bob phase={(index * 0.37) % 1}><Bean userId={user.id} size={56} /></Bob>
            <span class="handle">{user.handle}</span>
            {user.id === current.leaderId ? <span class="badge">Leader</span> : null}
            {leading && user.id !== selfId ? (
              <ActionButton label="Make leader" ariaLabel={`Make ${user.handle} leader`} kind="quiet" run={async () => {
                try {
                  applyParty((await post<{ party: Party }>("/api/party/leader", { userId: user.id })).party);
                } catch (error) {
                  announceFailure(error, { not_leader: COPY.leaderOnly });
                }
              }} />
            ) : null}
          </li>
        ))}
      </ul>
      <div class="actions">
        {leading ? (
          <ActionButton label="Find a match" pendingLabel={COPY.finding} kind="primary" class="large" run={async () => {
            try {
              applyParty((await post<{ party: Party }>("/api/party/queue")).party);
            } catch (error) {
              announceFailure(error, { invalid_transition: COPY.alreadySearching, not_leader: COPY.leaderOnly });
            }
          }} />
        ) : (
          <p class="waiting">Waiting for {leader?.user.handle ?? "the leader"} to start a match</p>
        )}
        <LeavePartyButton current={current} />
      </div>
    </section>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Seat({ seat, userId, handle, fresh }: { seat: number; userId: number | null; handle: string; fresh: boolean }) {
  const drop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (fresh && drop.current !== null && !prefersReducedMotion()) {
      drop.current.animate([{ transform: "translateY(-28px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 480, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
  }, [fresh]);
  return (
    <li class={`seat ${userId === null ? "empty" : "filled"}`} data-user-id={userId ?? undefined}>
      {userId === null ? <span class="seat-number">{seat}</span> : (
        <span ref={drop} class="seat-bean">
          <Bob phase={(seat * 0.29) % 1}><Bean userId={userId} size={44} /></Bob>
          <span class="handle">{handle}</span>
        </span>
      )}
    </li>
  );
}

function LobbyView({ current, selfId }: { current: Party; selfId: number }) {
  const view = useStore(lobby);
  const leading = current.leaderId === selfId;
  const counting = view?.lobby.state === "countdown" && view.deadline !== null;
  const now = useNow(counting);
  const seen = useRef<Set<number> | null>(null);
  const seatIds = view?.lobby.seats.map((seat) => seat.userId) ?? [];
  const fresh = new Set<number>();
  if (seen.current !== null) for (const id of seatIds) if (!seen.current.has(id)) fresh.add(id);
  useLayoutEffect(() => {
    seen.current = new Set(seatIds);
  });

  if (current.state === "queued") {
    return (
      <section role="region" aria-label="Lobby" class="card lobby">
        <h2>Finding a lobby</h2>
        <p class="searching">{COPY.finding}</p>
        <div class="actions">
          {leading ? (
            <ActionButton label="Cancel search" kind="secondary" run={async () => {
              try {
                applyParty((await post<{ party: Party }>("/api/party/queue/cancel")).party);
              } catch (error) {
                announceFailure(error, { invalid_transition: COPY.notSearching, not_leader: COPY.leaderOnly });
              }
            }} />
          ) : null}
          <LeavePartyButton current={current} />
        </div>
      </section>
    );
  }
  const seats = new Map(view?.lobby.seats.map((seat) => [seat.seat, seat.userId]) ?? []);
  const nameOf = (userId: number): string => current.members.find((member) => member.user.id === userId)?.user.handle ?? "";
  const secondsLeft = counting && view.deadline !== null ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : 0;
  return (
    <section role="region" aria-label="Lobby" class="card lobby" data-lobby-id={view?.lobby.id} data-state={view?.lobby.state}>
      <div class="lobby-head">
        <h2>Lobby</h2>
        <p role="status" aria-label="Seats" class="numeric seats-count">{view?.lobby.seats.length ?? 0} of {LOBBY_SIZE} seated</p>
        {counting ? <p role="timer" aria-label="Countdown" class="countdown numeric">Starting in {secondsLeft}</p> : null}
      </div>
      <ul aria-label="Seats" class="seats">
        {Array.from({ length: LOBBY_SIZE }, (_, index) => {
          const userId = seats.get(index + 1) ?? null;
          return <Seat key={`${index + 1}-${userId ?? 0}`} seat={index + 1} userId={userId} handle={userId === null ? "" : nameOf(userId)}
            fresh={userId !== null && fresh.has(userId)} />;
        })}
      </ul>
      <div class="actions">
        {leading ? (
          <ActionButton label="Leave lobby" kind="secondary" run={async () => {
            try {
              applyParty((await post<{ party: Party }>("/api/lobby/leave")).party);
              announce(COPY.leftLobby);
            } catch (error) {
              announceFailure(error, { not_leader: COPY.leaderOnly });
            }
          }} />
        ) : null}
        <LeavePartyButton current={current} />
      </div>
    </section>
  );
}

interface FinalStanding {
  userId: number;
  handle: string;
  rank: number;
  text: string;
}

// Final standings: the winner, then players by how far they got, then by their place in the round they went out.
function finalStandings(match: Match): FinalStanding[] {
  const handles = new Map(match.participants.map((user) => [user.id, user.handle]));
  const rows = match.participants.map((user) => {
    let reached = 0;
    let position = 0;
    let outIn = "";
    for (const round of match.rounds) {
      const result = round.results.find((entry) => entry.userId === user.id);
      if (result === undefined) continue;
      reached = round.n;
      position = result.position;
      if (result.outcome === "eliminated") outIn = round.name;
    }
    return { userId: user.id, reached, position, text: user.id === match.winnerId ? "Winner" : `Out in ${outIn}` };
  });
  rows.sort((a, b) => Number(b.userId === match.winnerId) - Number(a.userId === match.winnerId) || b.reached - a.reached || a.position - b.position);
  return rows.map((row, index) => ({ userId: row.userId, handle: handles.get(row.userId) ?? "", rank: index + 1, text: row.text }));
}

function ResultsView({ matchId }: { matchId: number }) {
  const [match, setMatch] = useState<Match | null>(null);
  useEffect(() => {
    void get<{ match: Match }>(`/api/matches/${matchId}`).then((body) => setMatch(body.match)).catch(() => undefined);
  }, [matchId]);
  return (
    <section role="region" aria-label="Results" class="card results">
      <h2 class="display">Cup #{matchId} results</h2>
      <ol aria-label="Final standings" class="standings">
        {(match === null ? [] : finalStandings(match)).map((row) => (
          <li key={row.userId} data-user-id={row.userId} class={row.text === "Winner" ? "winner" : ""}>
            <span class="numeric rank">{row.rank}</span>
            <Bean userId={row.userId} />
            <span class="handle">{row.handle}</span>
            <span class="note">{row.text}</span>
          </li>
        ))}
      </ol>
      <ul class="round-links">
        {(match?.rounds ?? []).map((round) => (
          <li key={round.n}><a href={`/matches/${matchId}/rounds/${round.n}`}>Photo-finish: {round.name}</a></li>
        ))}
      </ul>
      <div class="actions">
        <button type="button" class="button primary" onClick={() => results.set(null)}>Back to party</button>
      </div>
    </section>
  );
}

export function Stage() {
  const self = useStore(me);
  const current = useStore(party);
  const finished = useStore(results);
  const watching = useStore(live);
  useEffect(() => {
    if (current?.state === "in_match" && current.matchId !== null) void followMatch(current.matchId).catch(() => undefined);
    else if (watching !== null && current !== null && current.state !== "in_match") leaveMatch();
  }, [current?.state, current?.matchId]);
  if (self === null || self === undefined || current === null) {
    return <section role="region" aria-label="Party" class="card party-card"><p>Loading your party…</p></section>;
  }
  let view;
  if (current.state === "in_match") view = <MatchView selfId={self.id} current={current} />;
  else if (current.state === "queued" || current.state === "in_lobby") view = <LobbyView current={current} selfId={self.id} />;
  else if (finished !== null) view = <ResultsView matchId={finished} />;
  else view = <PartyView current={current} selfId={self.id} />;
  return (
    <div class="stage-inner">
      <PartyInvites />
      {view}
      <ResultBanner />
    </div>
  );
}
