import { useEffect, useState } from 'react';
import { hueForUserId } from '../../shared/hue.js';
import { LOBBY_SIZE } from '../../shared/rounds.js';
import type { Match, Party, User } from '../../shared/types.js';
import { roundName } from '../../shared/rounds.js';
import { copy } from '../lib/copy.js';
import { Link } from '../lib/router.js';
import { store, useApp } from '../lib/store.js';
import { Bean } from '../lib/ui.js';

export function PartyInvites() {
  const { incomingInvites, pending } = useApp();
  if (incomingInvites.length === 0) return null;
  return (
    <section className="card invites" aria-label="Party invites">
      <h2>Party invites</h2>
      <ul className="plain-list">
        {incomingInvites.map((invite) => (
          <li key={invite.id} className="invite-row" data-user-id={invite.from.id}>
            <Bean hue={invite.from.hue} size={28} />
            <span className="handle">{invite.from.handle}</span>
            <button
              type="button"
              className="primary"
              disabled={pending[`join-${invite.id}`] === true}
              aria-busy={pending[`join-${invite.id}`] === true}
              onClick={() => void store.acceptInvite(invite.id, invite.from.handle)}
            >
              {`Join ${invite.from.handle}'s party`}
            </button>
            <button type="button" onClick={() => void store.declineInvite(invite.id)}>
              {`Decline invite from ${invite.from.handle}`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeaveParty({ party }: { party: Party }) {
  const { pending } = useApp();
  if (party.members.length < 2) return null;
  return (
    <button
      type="button"
      disabled={pending['leave-party'] === true}
      aria-busy={pending['leave-party'] === true}
      onClick={() => void store.leaveParty()}
    >
      Leave party
    </button>
  );
}

export function PartyView({ party }: { party: Party }) {
  const { me, pending } = useApp();
  if (me === null) return null;
  const leader = party.members.find((member) => member.user.id === party.leaderId);
  const amLeader = party.leaderId === me.id;
  return (
    <section className="card party-card" aria-label="Party">
      <h2>Your party</h2>
      <ul className="party-members" aria-label="Party members">
        {party.members.map((member) => (
          <li
            key={member.user.id}
            data-user-id={member.user.id}
            data-leader={member.user.id === party.leaderId ? 'true' : undefined}
            className="party-member"
          >
            <Bean hue={member.user.hue} size={56} bob />
            <span className="handle">{member.user.handle}</span>
            {member.user.id === party.leaderId ? <span className="badge">Leader</span> : null}
            {amLeader && member.user.id !== me.id ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => void store.makeLeader(member.user.id, member.user.handle)}
              >
                {`Make ${member.user.handle} leader`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="party-actions">
        {amLeader ? (
          <button
            type="button"
            className="primary"
            disabled={pending.queue === true}
            aria-busy={pending.queue === true}
            onClick={() => void store.findMatch()}
          >
            Find a match
          </button>
        ) : (
          <p className="waiting-line">
            {copy.waitingForLeader(leader?.user.handle ?? 'your leader')}
          </p>
        )}
        <LeaveParty party={party} />
      </div>
      {pending.queue === true ? <p className="pending-copy">{copy.findingMatch}</p> : null}
    </section>
  );
}

function Countdown({ endsAt }: { endsAt: string }) {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLeft(Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)));
    }, 200);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  return (
    <div role="timer" aria-label="Countdown" className="countdown">
      {`Starting in ${left}`}
    </div>
  );
}

export function LobbyView({ party }: { party: Party }) {
  const { me, lobby, pending } = useApp();
  if (me === null) return null;
  const amLeader = party.leaderId === me.id;

  if (party.state === 'queued' || lobby === null) {
    return (
      <section className="card lobby-card" aria-label="Finding a match">
        <h2>Finding a match</h2>
        <p className="searching-notice">{copy.findingMatch}</p>
        <div className="party-actions">
          {amLeader ? (
            <button
              type="button"
              disabled={pending['cancel-search'] === true}
              aria-busy={pending['cancel-search'] === true}
              onClick={() => void store.cancelSearch()}
            >
              Cancel search
            </button>
          ) : null}
          <LeaveParty party={party} />
        </div>
      </section>
    );
  }

  const seated = lobby.seats.filter((seat) => seat.userId !== null).length;
  return (
    <section
      className="card lobby-card"
      aria-label="Lobby"
      data-lobby-id={lobby.id}
      data-state={lobby.state}
    >
      <h2>Lobby</h2>
      <div role="status" aria-label="Seats" className="seat-count">
        {`${seated} of ${LOBBY_SIZE} seated`}
      </div>
      <ul className="seat-grid" aria-label="Seats">
        {lobby.seats.map((seat) => (
          <li
            key={seat.seat}
            className={`seat${seat.userId === null ? ' seat-open' : ' seat-filled'}`}
            data-user-id={seat.userId ?? undefined}
          >
            {seat.userId === null ? (
              <span className="seat-number">{seat.seat}</span>
            ) : (
              <Bean hue={hueForUserId(seat.userId)} size={36} bob />
            )}
          </li>
        ))}
      </ul>
      {lobby.state === 'countdown' && lobby.countdownEndsAt !== null ? (
        <Countdown endsAt={lobby.countdownEndsAt} />
      ) : null}
      <div className="party-actions">
        {amLeader ? (
          <button
            type="button"
            disabled={pending['leave-lobby'] === true}
            aria-busy={pending['leave-lobby'] === true}
            onClick={() => void store.leaveLobby()}
          >
            Leave lobby
          </button>
        ) : null}
        <LeaveParty party={party} />
      </div>
    </section>
  );
}

export function ResultsView({ match }: { match: Match }) {
  const standings = finalStandings(match);
  return (
    <section className="card results-card" aria-label="Results">
      <h2 className="display">{`Cup #${match.id} results`}</h2>
      <ol className="standings" aria-label="Final standings">
        {standings.map((entry, index) => (
          <li key={entry.user.id} data-user-id={entry.user.id} className="standing-row">
            <span className="rank-number">{index + 1}</span>
            <Bean hue={entry.user.hue} size={32} />
            <Link to={`/u/${entry.user.handle}`} className="handle">
              {entry.user.handle}
            </Link>
            <span className={entry.winner ? 'tag-qualified' : 'tag-eliminated'}>
              {entry.placement}
            </span>
          </li>
        ))}
      </ol>
      <ul className="plain-list">
        {match.rounds.map((round) => (
          <li key={round.n}>
            <Link to={`/matches/${match.id}/rounds/${round.n}`}>
              {`Photo-finish: ${round.name}`}
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="primary" onClick={() => store.clearResults()}>
        Back to party
      </button>
    </section>
  );
}

interface Standing {
  user: User;
  placement: string;
  winner: boolean;
}

/** Winner first, then the players knocked out latest. */
export function finalStandings(match: Match): Standing[] {
  const entries = match.participants.map((user) => {
    if (match.winnerId === user.id) {
      return { user, placement: 'Winner', winner: true, round: 99, position: 0 };
    }
    for (const round of match.rounds) {
      const result = round.results.find((candidate) => candidate.userId === user.id);
      if (result !== undefined && result.outcome === 'eliminated') {
        return {
          user,
          placement: `Out in ${roundName(round.kind)}`,
          winner: false,
          round: round.n,
          position: result.position,
        };
      }
    }
    return { user, placement: 'Out in Wobble Dash', winner: false, round: 0, position: 99 };
  });
  entries.sort((a, b) => b.round - a.round || a.position - b.position);
  return entries.map((entry) => ({
    user: entry.user,
    placement: entry.placement,
    winner: entry.winner,
  }));
}
