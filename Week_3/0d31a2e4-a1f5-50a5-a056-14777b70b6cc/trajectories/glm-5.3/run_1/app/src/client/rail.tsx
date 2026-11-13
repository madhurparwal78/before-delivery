import { useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { Bean, Icon, usePending } from "./ui";
import { PRESENCE_TEXT, type Presence } from "./types";

export function PresenceDot({ presence }: { presence: Presence }): JSX.Element {
  return (
    <span className="dot" data-presence={presence} title={PRESENCE_TEXT[presence]}>
      <span className="sr-only">{PRESENCE_TEXT[presence]}</span>
    </span>
  );
}

function FriendRow({ userId, handle }: { userId: number; handle: string }): JSX.Element {
  const [busy, run] = usePending();
  const party = store.party;
  const inMyParty = party?.members.some((m) => m.user.id === userId) ?? false;
  const isLeader = party?.leaderId === store.me?.id;
  const presence = store.presenceOf(userId);

  const invite = run(async () => {
    try {
      await api.post("/api/party/invites", { userId });
      store.notify(`Invite sent to ${handle}.`, "success");
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <li className="friend-row" data-user-id={userId} data-presence={presence}>
      <Bean userId={userId} />
      <a className="friend-handle truncate" href={`#/u/${handle}`}>
        {handle}
      </a>
      <PresenceDot presence={presence} />
      <span className="friend-actions">
        <button
          type="button"
          className="row-btn"
          title={`Invite ${handle} to party`}
          aria-label={`Invite ${handle} to party`}
          disabled={busy || inMyParty || !isLeader}
          onClick={() => void invite()}
        >
          <Icon name="userPlus" size={16} />
        </button>
        <button
          type="button"
          className="row-btn"
          title={`Message ${handle}`}
          aria-label={`Message ${handle}`}
          onClick={() => {
            store.conversations = [userId, ...store.conversations.filter((id) => id !== userId)];
            store.dmThreads.set(userId, store.dmThreads.get(userId) ?? []);
            store.emit();
            location.hash = "#/";
            window.dispatchEvent(new CustomEvent("pc-open-dm", { detail: userId }));
          }}
        >
          <Icon name="message" size={16} />
        </button>
      </span>
    </li>
  );
}

function RequestsList(): JSX.Element {
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (id: number, action: "accept" | "decline" | "withdraw"): Promise<void> => {
    setBusyId(id);
    try {
      if (action === "accept") {
        await api.post(`/api/friends/requests/${id}/accept`);
        const incoming = store.friends.incoming.find((r) => r.id === id);
        store.notify(`You and ${incoming?.from.handle ?? "them"} are now friends.`, "success");
      } else if (action === "decline") {
        await api.post(`/api/friends/requests/${id}/decline`);
        store.notify("Request declined.", "success");
      } else {
        await api.del(`/api/friends/requests/${id}`);
        store.notify("Request withdrawn.", "success");
      }
      await store.refreshFriends();
      await store.refreshParty();
    } catch (e) {
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const { incoming, outgoing } = store.friends;
  if (incoming.length === 0 && outgoing.length === 0) return <ul className="requests-list" aria-label="Requests" />;

  return (
    <ul className="requests-list" aria-label="Requests">
      {incoming.map((request) => (
        <li key={request.id} className="friend-row">
          <Bean userId={request.from.id} />
          <span className="friend-handle truncate">{request.from.handle}</span>
          <span className="friend-actions">
            <button
              type="button"
              className="row-btn"
              aria-label={`Accept ${request.from.handle}`}
              disabled={busyId === request.id}
              onClick={() => void act(request.id, "accept")}
            >
              <Icon name="check" size={16} />
            </button>
            <button
              type="button"
              className="row-btn"
              aria-label={`Decline ${request.from.handle}`}
              disabled={busyId === request.id}
              onClick={() => void act(request.id, "decline")}
            >
              <Icon name="x" size={16} />
            </button>
          </span>
        </li>
      ))}
      {outgoing.map((request) => (
        <li key={request.id} className="friend-row">
          <Bean userId={request.to.id} />
          <span className="friend-handle truncate">{request.to.handle}</span>
          <span className="friend-actions">
            <button
              type="button"
              className="row-btn"
              aria-label={`Withdraw request to ${request.to.handle}`}
              disabled={busyId === request.id}
              onClick={() => void act(request.id, "withdraw")}
            >
              <Icon name="arrowLeft" size={16} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AddFriendForm(): JSX.Element {
  const [handle, setHandle] = useState("");
  const [busy, run] = usePending();
  const [error, setError] = useState<string | null>(null);

  const send = run(async () => {
    setError(null);
    try {
      const result = await api.post<{
        request?: { to: { handle: string } };
        friendship?: { user: { handle: string } };
      }>("/api/friends/requests", { handle });
      if (result.friendship) {
        store.notify(`You and ${result.friendship.user.handle} are now friends.`, "success");
      } else if (result.request) {
        store.notify(`Friend request sent to ${result.request.to.handle}.`, "success");
      }
      setHandle("");
      await store.refreshFriends();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields) {
          setError(e.fields["handle"] ?? "Check this field.");
          store.notify("Check the highlighted fields.", "error");
        } else {
          store.notify(e.message, "error");
          setError(null);
        }
      }
    }
  });

  return (
    <div className="add-friend">
      <label className="sr-only" htmlFor="add-friend">
        Add friend by handle
      </label>
      <input
        id="add-friend"
        placeholder="Add friend by handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? "add-friend-err" : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p className="field-error" id="add-friend-err" style={{ width: "100%", margin: 0 }}>
          {error}
        </p>
      )}
      <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void send()}>
        {busy ? "Sending…" : "Send request"}
      </button>
    </div>
  );
}

export function RailBody(): JSX.Element {
  const party = store.party;
  const me = store.me;
  const partyMembers = party?.members ?? [];
  const partyIds = new Set(partyMembers.map((m) => m.user.id));
  const friends = store.friends.friends.filter((f) => !partyIds.has(f.user.id));

  return (
    <>
      {partyMembers.length > 0 && (
        <section className="rail-section" aria-label="In your party">
          <h3 className="rail-heading">In your party</h3>
          <ul className="party-list" aria-label="In your party">
            {partyMembers.map((member, index) => (
              <li key={member.user.id} className="party-row" data-user-id={member.user.id}>
                <Bean userId={member.user.id} bob={party ? party.state === "idle" : false} bobDelay={index * 0.18} />
                <span className="party-handle truncate">
                  <a href={`#/u/${member.user.handle}`}>{member.user.handle}</a>
                  {member.user.id === me?.id ? " (you)" : ""}
                </span>
                {party?.leaderId === member.user.id && <span className="leader-badge">Leader</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rail-section">
        <h3 className="rail-heading">Friends</h3>
        <ul className="friends-list" aria-label="Friends">
          {friends.map((friend) => (
            <FriendRow key={friend.user.id} userId={friend.user.id} handle={friend.user.handle} />
          ))}
        </ul>
        {friends.length === 0 && <p style={{ color: "var(--ink-soft)", margin: "4px 0" }}>No friends yet.</p>}
      </section>

      <section className="rail-section">
        <h3 className="rail-heading">Requests</h3>
        <RequestsList />
      </section>

      <div style={{ marginTop: 8 }}>
        <AddFriendForm />
      </div>
      <div style={{ marginTop: 14 }}>
        <a className="btn btn-small" role="button" href={`#/u/${me?.handle ?? ""}`}>
          Your profile
        </a>
      </div>
    </>
  );
}
