import { useCallback, useEffect, useState, type FormEvent } from "react";
import { call } from "../lib/api";
import { LIVE_DOWN_TEXT } from "../../shared/protocol";
import { Link, navigate } from "../lib/router";
import { pushed, showNotice, useStore } from "../lib/store";
import { useAction, useResult } from "../lib/useAction";
import { Chip, Empty, Loading, Status } from "../ui/Bits";
import { Icon } from "../ui/Icon";
import { Denied } from "./NotFound";

interface Friend {
  personId: string;
  displayName: string;
  presence: "online" | "in-session" | "offline";
  session: { id: string; roomName: string } | null;
}

interface Invite {
  id: string;
  email: string;
  state: "pending" | "used" | "revoked" | "expired";
  expiresAt: string;
}

export function Friends() {
  const version = useStore(pushed).friends;
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const sending = useAction("Sending invite...");
  const { result: joinResult, set: setJoinResult } = useResult();

  const load = useCallback(async (): Promise<void> => {
    const [mine, sent] = await Promise.all([call<{ friends: Friend[] }>("GET", "/api/friends"), call<{ invites: Invite[] }>("GET", "/api/friends/invites")]);
    if (mine.ok) setFriends(mine.data.friends);
    if (sent.ok) setInvites(sent.data.invites);
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const reply = await sending.run("POST", "/api/friends/invites", { email }, () => "Invite on its way.");
    if (reply.ok) {
      setEmail("");
      await load();
    }
  };

  const join = async (friend: Friend): Promise<void> => {
    if (!friend.session) return;
    setJoinResult({ text: "Opening...", kind: "pending" });
    const reply = await call("POST", `/api/sessions/${friend.session.id}/join`);
    if (reply.ok) navigate(`/sessions/${friend.session.id}`);
    else {
      setJoinResult({ text: reply.error, kind: "refused" });
      if (reply.error === LIVE_DOWN_TEXT) showNotice(LIVE_DOWN_TEXT);
    }
  };

  return (
    <>
      <h1 tabIndex={-1}>Friends</h1>
      <section className="panel">
        <h2>Your friends</h2>
        {friends === null ? (
          <Loading />
        ) : friends.length === 0 ? (
          <Empty>No friends yet. Send an invite below.</Empty>
        ) : (
          <ul aria-label="Friends" className="cards">
            {friends.map((friend) => (
              <li key={friend.personId} data-person-id={friend.personId} data-presence={friend.presence} className="row-card">
                <div>
                  <strong>{friend.displayName}</strong>
                  <div className="row tight">
                    <Chip tone={friend.presence === "offline" ? "plain" : "calm"}>
                      <Icon name={friend.presence === "offline" ? "close" : "check"} size={14} /> {friend.presence}
                    </Chip>
                    {friend.session ? <span className="muted">in {friend.session.roomName}</span> : null}
                  </div>
                </div>
                <div className="row tight">
                  {friend.session ? (
                    <button type="button" className="button primary" aria-label={`Join ${friend.displayName}`} onClick={() => void join(friend)}>
                      Join
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove friend ${friend.displayName}`}
                    onClick={() => void call("DELETE", `/api/friends/${friend.personId}`).then(load)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="result result-refused" aria-live="polite">
          {joinResult.kind === "refused" ? joinResult.text : ""}
        </p>
      </section>
      <section className="panel">
        <h2>Invite a friend</h2>
        <form onSubmit={send} className="stack">
          <label className="field">
            <span>Friend's email</span>
            <input type="email" aria-label="Friend's email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <div className="row">
            <button type="submit" className="button primary" disabled={sending.busy} aria-busy={sending.busy}>
              <Icon name="invite" size={18} /> Send invite
            </button>
          </div>
          <Status name="Invite result" result={sending.result} />
        </form>
        <h3>Sent invites</h3>
        {invites === null ? (
          <Loading rows={1} />
        ) : invites.length === 0 ? (
          <Empty>No invites sent yet.</Empty>
        ) : (
          <ul aria-label="Sent invites" className="cards">
            {invites.map((invite) => (
              <li key={invite.id} className="row-card">
                <div>
                  <strong>{invite.email}</strong>
                  <div className="row tight">
                    <Chip tone={invite.state === "pending" ? "accent" : "plain"}>{invite.state}</Chip>
                  </div>
                </div>
                {invite.state === "pending" ? (
                  <button
                    type="button"
                    className="button"
                    aria-label={`Revoke invite to ${invite.email}`}
                    onClick={() => void call("DELETE", `/api/friends/invites/${invite.id}`).then(load)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function Invite({ token }: { token: string }) {
  const [from, setFrom] = useState<string | null | undefined>(undefined);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    void call<{ from: string }>("GET", `/api/invites/${encodeURIComponent(token)}`).then((reply) => setFrom(reply.ok ? reply.data.from : null));
  }, [token]);
  const accept = async (): Promise<void> => {
    const reply = await call("POST", `/api/invites/${encodeURIComponent(token)}/accept`);
    if (reply.ok) setAccepted(true);
    else setFrom(null);
  };
  if (from === undefined) return <Loading rows={1} />;
  if (from === null) return <Denied heading="This invite isn't available." />;
  return (
    <section className="panel narrow">
      <h1 tabIndex={-1}>{accepted ? "You are now friends" : `${from} invited you to Hearthtile`}</h1>
      {accepted ? (
        <p>
          <Link to="/friends" className="button primary">
            See your friends
          </Link>
        </p>
      ) : (
        <button type="button" className="button primary" onClick={() => void accept()}>
          Accept invite
        </button>
      )}
    </section>
  );
}
