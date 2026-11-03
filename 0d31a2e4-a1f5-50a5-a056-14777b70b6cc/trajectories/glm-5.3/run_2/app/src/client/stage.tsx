import { api, ApiError } from "./api";
import { store } from "./store";
import { Bean, Icon, useCountdown, usePending } from "./ui";

function PartyInvites(): JSX.Element | null {
  const invites = store.invites.incoming;
  const [busy] = usePending();

  if (invites.length === 0) return null;

  const accept = async (id: number, handle: string): Promise<void> => {
    try {
      await api.post(`/api/party/invites/${id}/accept`);
      store.notify(`You joined ${handle}'s party.`, "success");
      await store.refreshParty();
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  };

  const decline = async (id: number): Promise<void> => {
    try {
      await api.post(`/api/party/invites/${id}/decline`);
      store.notify("Invite declined.", "success");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  };

  return (
    <section className="panel" aria-label="Party invites" style={{ marginBottom: 16 }}>
      <ul className="requests-list">
        {invites.map((invite) => (
          <li key={invite.id} className="friend-row">
            <Bean userId={invite.from.id} />
            <span className="friend-handle truncate">{invite.from.handle}</span>
            <span className="friend-actions">
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void accept(invite.id, invite.from.handle)}
              >
                Join {invite.from.handle}'s party
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => void decline(invite.id)}
              >
                Decline invite from {invite.from.handle}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PartyView(): JSX.Element {
  const party = store.party;
  const me = store.me;
  const [queueBusy, runQueue] = usePending();
  const [leaveBusy, runLeave] = usePending();
  if (!party || !me) return <div className="stage-inner" />;

  const isLeader = party.leaderId === me.id;

  const queue = runQueue(async () => {
    try {
      await api.post("/api/party/queue");
      store.notify("Finding a match…", "info");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const leave = runLeave(async () => {
    try {
      await api.post("/api/party/leave");
      store.notify("You left the party.", "success");
      await store.refreshParty();
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const handOver = async (userId: number, handle: string): Promise<void> => {
    try {
      await api.post("/api/party/leader", { userId });
      store.notify(`${handle} is now party leader.`, "success");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  };

  const leader = party.members.find((m) => m.user.id === party.leaderId);

  return (
    <div className="stage-inner">
      <PartyInvites />
      <div className="stage-center">
        <section className="panel" aria-label="Party">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h2>Your party</h2>
            {party.members.length > 1 && (
              <button type="button" className="btn btn-small" disabled={leaveBusy} aria-busy={leaveBusy} onClick={() => void leave()}>
                Leave party
              </button>
            )}
          </div>
          <ul className="party-grid" aria-label="Party members" style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
            {party.members.map((member, index) => (
              <li key={member.user.id} className="member-card" data-user-id={member.user.id} data-leader={member.user.id === party.leaderId ? "true" : undefined}>
                <Bean userId={member.user.id} size={54} bob bobDelay={index * 0.18} />
                <span className="truncate" style={{ fontWeight: 700 }}>
                  {member.user.handle}
                  {member.user.id === me.id ? " (you)" : ""}
                </span>
                {member.user.id === party.leaderId && <span className="leader-badge">Leader</span>}
                {isLeader && member.user.id !== me.id && (
                  <button type="button" className="btn btn-small" onClick={() => void handOver(member.user.id, member.user.handle)}>
                    Make {member.user.handle} leader
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {isLeader ? (
              <button type="button" className="btn btn-primary" disabled={queueBusy} aria-busy={queueBusy} onClick={() => void queue()}>
                {queueBusy ? "Finding a match…" : "Find a match"}
              </button>
            ) : (
              <p style={{ margin: 0, fontWeight: 700 }}>
                Waiting for {leader?.user.handle ?? "the leader"} to start a match
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function LobbyView(): JSX.Element {
  const party = store.party;
  const lobby = store.lobby;
  const me = store.me;
  const [cancelBusy, runCancel] = usePending();
  const [leaveLobbyBusy, runLeaveLobby] = usePending();
  const [leavePartyBusy, runLeaveParty] = usePending();
  if (!party || !me) return <div className="stage-inner" />;

  const isLeader = party.leaderId === me.id;
  const queued = party.state === "queued";

  const cancel = runCancel(async () => {
    try {
      await api.post("/api/party/queue/cancel");
      store.notify("Search cancelled.", "success");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const leaveLobby = runLeaveLobby(async () => {
    try {
      await api.post("/api/lobby/leave");
      store.notify("You left the lobby.", "success");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const leaveParty = runLeaveParty(async () => {
    try {
      await api.post("/api/party/leave");
      store.notify("You left the party.", "success");
      await store.refreshParty();
      await store.refreshFriends();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  const seats = lobby?.seats ?? [];
  const seatedByUser = new Map(seats.map((seat) => [seat.userId, seat]));
  const countdownEnds = lobby?.countdownEndsAt ? new Date(lobby.countdownEndsAt).getTime() : null;
  const [secondsLeft] = useCountdown(countdownEnds);

  const allMembers = party.members;
  const allSeated = allMembers.map((member) => seatedByUser.get(member.user.id)).filter(Boolean);

  return (
    <div className="stage-inner">
      <div className="stage-center">
        <section className="panel" aria-label="Lobby" data-lobby-id={lobby?.id} data-state={lobby?.state}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2>{queued ? "Finding a match…" : "Lobby"}</h2>
            <span style={{ display: "flex", gap: 10 }}>
              {isLeader && queued && (
                <button type="button" className="btn btn-small" disabled={cancelBusy} aria-busy={cancelBusy} onClick={() => void cancel()}>
                  Cancel search
                </button>
              )}
              {isLeader && !queued && (
                <button type="button" className="btn btn-small" disabled={leaveLobbyBusy} aria-busy={leaveLobbyBusy} onClick={() => void leaveLobby()}>
                  Leave lobby
                </button>
              )}
              {party.members.length >= 2 && (
                <button type="button" className="btn btn-small" disabled={leavePartyBusy} aria-busy={leavePartyBusy} onClick={() => void leaveParty()}>
                  Leave party
                </button>
              )}
            </span>
          </div>

          {queued ? (
            <p style={{ fontWeight: 700, marginTop: 12 }}>Searching for players…</p>
          ) : (
            <>
              <p role="status" aria-label="Seats" style={{ fontWeight: 700, marginTop: 12 }}>
                {allSeated.length} of 12 seated
              </p>
              <ul className="seats-grid" aria-label="Seats" style={{ listStyle: "none", padding: 0, marginTop: 14 }}>
                {Array.from({ length: 12 }, (_, i) => {
                  const seat = seats.find((s) => s.seat === i + 1);
                  return (
                    <li key={i} className={seat ? "seat filled" : "seat"} data-user-id={seat?.userId}>
                      {seat && <Bean userId={seat.userId} size={44} bob bobDelay={(i % 4) * 0.2} />}
                      {!seat && <span style={{ color: "var(--ink-pale)" }}>Seat {i + 1}</span>}
                    </li>
                  );
                })}
              </ul>
              {lobby?.state === "countdown" && (
                <p style={{ marginTop: 16 }} role="timer" aria-label="Countdown">
                  Starting in <span className="countdown-num">{secondsLeft}</span>
                </p>
              )}
              {lobby?.state === "filling" && <p style={{ marginTop: 16, fontWeight: 700 }}>Waiting for players…</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function ResultsView({ onBack }: { onBack: () => void }): JSX.Element {
  const match = store.match;
  const me = store.me;
  if (!match) return <div className="stage-inner" />;
  const standings = [...(match.rounds[match.rounds.length - 1]?.results ?? [])].sort((a, b) => a.position - b.position);
  const handleOf = (userId: number): string => match.participants.find((p) => p.id === userId)?.handle ?? String(userId);

  return (
    <div className="stage-inner">
      <div className="stage-center">
        <section className="panel" aria-label="Results">
          <h2>Cup #{match.id} results</h2>
          <ul className="standings-list" aria-label="Final standings" style={{ marginTop: 14 }}>
            {standings.map((row) => (
              <li key={row.userId} className="standings-row" style={{ fontSize: 15 }}>
                <span className="rank num">{row.position}</span>
                <Bean userId={row.userId} size={24} />
                <span className="truncate" style={{ flex: 1 }}>
                  {handleOf(row.userId)}
                  {row.userId === me?.id ? " (you)" : ""}
                </span>
                <span className="state-tag" style={{ color: row.outcome === "qualified" ? "var(--teal)" : "var(--red)", fontWeight: 700 }}>
                  {row.outcome === "qualified" ? "Winner" : "Out"}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {match.rounds.map((round) => (
              <a key={round.n} className="match-link" href={`#/matches/${match.id}/rounds/${round.n}`}>
                <span>Photo-finish: {round.name}</span>
                <Icon name="camera" size={18} />
              </a>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-primary" onClick={onBack}>
              Back to party
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
