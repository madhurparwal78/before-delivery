import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LIVE_DOWN_TEXT, VISIBILITIES, type SessionSummary } from "../../shared/protocol";
import { call } from "../lib/api";
import { navigate } from "../lib/router";
import { account, patchMe, pushed, showNotice, useStore } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Chip, Empty, Loading, Status } from "../ui/Bits";
import { Dialog, useDialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

interface AssetOption {
  id: string;
  name: string;
}

interface CommunityOption {
  id: string;
  name: string;
  role: string;
}

function SessionRow({ session, label, join }: { session: SessionSummary; label: string; join: (id: string) => void }) {
  return (
    <li data-session-id={session.id} className="row-card">
      <div>
        <strong>{session.roomName}</strong>
        <span className="muted"> hosted by {session.hostName}</span>
        <div className="row tight">
          <Chip>{session.visibility}</Chip>
          <Chip>
            {session.count} of {session.capacity} here
          </Chip>
        </div>
      </div>
      <button type="button" className="button primary" aria-label={`Join ${label}`} onClick={() => join(session.id)}>
        Join
      </button>
    </li>
  );
}

export function Sessions() {
  const state = useStore(account);
  const me = state.state === "in" ? state.me : null;
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [friendsOnly, setFriendsOnly] = useState<SessionSummary[]>([]);
  const [avatars, setAvatars] = useState<AssetOption[]>([]);
  const [rooms, setRooms] = useState<AssetOption[]>([]);
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const sequence = useRef(0);
  const dialog = useDialog();
  const action = useAction("Opening...");
  const roleVersion = useStore(pushed).role;

  const search = useCallback(async (text: string): Promise<void> => {
    const mine = (sequence.current += 1);
    const reply = await call<{ sessions: SessionSummary[] }>("GET", `/api/sessions?q=${encodeURIComponent(text)}`);
    if (mine === sequence.current && reply.ok) setSessions(reply.data.sessions);
  }, []);

  useEffect(() => {
    void search("");
    void call<{ sessions: SessionSummary[] }>("GET", "/api/sessions").then((reply) => reply.ok && setFriendsOnly(reply.data.sessions.filter((session) => session.visibility === "friends")));
    void call<{ assets: AssetOption[] }>("GET", "/api/assets?kind=avatar").then((reply) => reply.ok && setAvatars(reply.data.assets));
    void call<{ assets: AssetOption[] }>("GET", "/api/assets?kind=room").then((reply) => reply.ok && setRooms(reply.data.assets));
  }, [search]);

  useEffect(() => {
    void call<{ communities: CommunityOption[] }>("GET", "/api/communities").then(
      (reply) => reply.ok && setCommunities(reply.data.communities.filter((community) => community.role !== "member")),
    );
  }, [roleVersion]);

  const join = async (id: string): Promise<void> => {
    const reply = await action.run("POST", `/api/sessions/${id}/join`, undefined, () => "");
    if (reply.ok) navigate(`/sessions/${id}`);
    else if (reply.error === LIVE_DOWN_TEXT) showNotice(LIVE_DOWN_TEXT);
  };

  const wear = async (avatarId: string): Promise<void> => {
    const reply = await call("PUT", "/api/me/avatar", { avatarId });
    if (reply.ok) patchMe({ avatarId });
  };

  return (
    <>
      <h1 tabIndex={-1}>Sessions</h1>
      <div className="toolbar">
        <label className="field grow">
          <span>Search sessions</span>
          <input
            type="search"
            aria-label="Search sessions"
            value={query}
            placeholder="Room or host name"
            onChange={(event) => {
              setQuery(event.target.value);
              void search(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Wear avatar</span>
          <select aria-label="Wear avatar" value={me?.avatarId ?? ""} onChange={(event) => void wear(event.target.value)}>
            {avatars.map((avatar) => (
              <option key={avatar.id} value={avatar.id}>
                {avatar.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button primary" onClick={(event) => dialog.show(event.currentTarget)}>
          <Icon name="sessions" size={18} /> Open a session
        </button>
      </div>
      <p className="count" role="status" aria-label="Session count">
        {sessions ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : ""}
      </p>
      {!dialog.open ? <Status name="Session result" result={action.result} /> : null}
      <section className="panel" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Open sessions</h2>
        {sessions === null ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <Empty>No open sessions match. Open one for your friends.</Empty>
        ) : (
          <ul aria-label="Sessions" className="cards">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} label={session.roomName} join={(id) => void join(id)} />
            ))}
          </ul>
        )}
      </section>
      <section className="panel" aria-labelledby="friends-heading">
        <h2 id="friends-heading">Friends' sessions</h2>
        {friendsOnly.length === 0 ? <Empty>None of your friends has a friends-only session open.</Empty> : null}
        <ul aria-label="Friends' sessions" className="cards">
          {friendsOnly.map((session) => (
            <SessionRow key={session.id} session={session} label={session.hostName} join={(id) => void join(id)} />
          ))}
        </ul>
      </section>
      <OpenDialog dialog={dialog} rooms={rooms} communities={communities} action={action} />
    </>
  );
}

function OpenDialog({
  dialog,
  rooms,
  communities,
  action,
}: {
  dialog: ReturnType<typeof useDialog>;
  rooms: AssetOption[];
  communities: CommunityOption[];
  action: ReturnType<typeof useAction>;
}) {
  const [room, setRoom] = useState("");
  const [visibility, setVisibility] = useState<string>("public");
  const [capacity, setCapacity] = useState("10");
  const [community, setCommunity] = useState("");
  const roomId = rooms.some((option) => option.id === room) ? room : (rooms[0]?.id ?? "");
  const communityId = communities.some((option) => option.id === community) ? community : (communities[0]?.id ?? "");
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const body = { roomId, visibility, capacity: Number(capacity), communityId: visibility === "community" ? communityId || null : null };
    const reply = await action.run<{ id: string }>("POST", "/api/sessions", body, () => "");
    if (reply.ok) navigate(`/sessions/${reply.data.id}`);
    else if (reply.error === LIVE_DOWN_TEXT) showNotice(LIVE_DOWN_TEXT);
  };
  return (
    <Dialog label="Open a session" handle={dialog}>
      <h2>Open a session</h2>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Room</span>
          <select value={roomId} onChange={(event) => setRoom(event.target.value)}>
            {rooms.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Visibility</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
            {VISIBILITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Capacity</span>
          <input type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
        </label>
        {visibility === "community" ? (
          <label className="field">
            <span>Community</span>
            <select value={communityId} onChange={(event) => setCommunity(event.target.value)}>
              {communities.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="row">
          <button type="submit" className="button primary" disabled={action.busy} aria-busy={action.busy}>
            Open session
          </button>
          <button type="button" className="button" onClick={dialog.hide}>
            Cancel
          </button>
        </div>
        <Status name="Session result" result={action.result} />
      </form>
    </Dialog>
  );
}
