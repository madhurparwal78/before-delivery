import { Check, MessageCircle, UserMinus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import type { FriendEntry, Party, Presence } from '../../shared/types.js';
import { Link } from '../lib/router.js';
import { store, useApp } from '../lib/store.js';
import { Bean, useDialog } from '../lib/ui.js';

const PRESENCE_TEXT: Record<Presence, string> = {
  offline: 'Offline',
  online: 'Online',
  in_party: 'In a party',
  in_match: 'In a match',
};

function PartyGroup({ party, myId }: { party: Party | null; myId: number }) {
  if (party === null) return null;
  return (
    <>
      <h3 className="rail-heading">In your party</h3>
      <ul className="rail-list" aria-label="In your party">
        {party.members.map((member) => (
          <li key={member.user.id} data-user-id={member.user.id} className="rail-row">
            <Bean hue={member.user.hue} size={28} />
            <span className="handle">
              {member.user.id === myId ? `${member.user.handle} (you)` : member.user.handle}
            </span>
            {party.leaderId === member.user.id ? <span className="badge">Leader</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function FriendRow({ entry }: { entry: FriendEntry }) {
  const { pending } = useApp();
  const handle = entry.user.handle;
  return (
    <li
      className="rail-row friend-row"
      data-user-id={entry.user.id}
      data-presence={entry.presence}
    >
      <Bean hue={entry.user.hue} size={28} />
      <Link to={`/u/${handle}`} className="handle">
        {handle}
      </Link>
      <span className={`presence-dot presence-${entry.presence}`} aria-hidden="true" />
      <span className="sr-only">{PRESENCE_TEXT[entry.presence]}</span>
      <span className="row-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Invite ${handle} to party`}
          disabled={pending[`invite-${entry.user.id}`] === true}
          aria-busy={pending[`invite-${entry.user.id}`] === true}
          onClick={() => void store.invitePlayer(entry.user.id, handle)}
        >
          <UserPlus aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Message ${handle}`}
          onClick={() => void store.openConversation(entry.user.id)}
        >
          <MessageCircle aria-hidden="true" size={18} />
        </button>
      </span>
    </li>
  );
}

function RailBody() {
  const state = useApp();
  const [handle, setHandle] = useState('');
  const me = state.me;
  if (me === null) return null;

  const submit = async (): Promise<void> => {
    const cleared = await store.sendFriendRequest(handle.trim().toLowerCase());
    if (cleared) setHandle('');
  };

  return (
    <div className="rail-body">
      <form
        className="add-friend"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="add-friend-field">
          Add friend by handle
        </label>
        <input
          id="add-friend-field"
          aria-label="Add friend by handle"
          placeholder="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
        <button
          type="submit"
          className="primary"
          disabled={state.pending['send-request'] === true}
          aria-busy={state.pending['send-request'] === true}
        >
          Send request
        </button>
      </form>
      <div className="rail-lists">
        <PartyGroup party={state.party} myId={me.id} />
        <h3 className="rail-heading">Friends</h3>
        <ul className="rail-list" aria-label="Friends">
          {state.friends.friends.map((entry) => (
            <FriendRow key={entry.user.id} entry={entry} />
          ))}
        </ul>
      </div>
      <p className="rail-profile-link">
        <Link to={`/u/${me.handle}`}>Your profile</Link>
      </p>
      <div className="rail-requests">
        <h3 className="rail-heading">Requests</h3>
        <ul className="rail-list" aria-label="Requests">
          {state.friends.incoming.map((request) => (
            <li key={`in-${request.id}`} className="rail-row" data-user-id={request.from.id}>
              <Bean hue={request.from.hue} size={24} />
              <span className="handle">{request.from.handle}</span>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Accept ${request.from.handle}`}
                  onClick={() => void store.acceptRequest(request.id, request.from.handle)}
                >
                  <Check aria-hidden="true" size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Decline ${request.from.handle}`}
                  onClick={() => void store.declineRequest(request.id)}
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </span>
            </li>
          ))}
          {state.friends.outgoing.map((request) => (
            <li key={`out-${request.id}`} className="rail-row" data-user-id={request.to.id}>
              <Bean hue={request.to.hue} size={24} />
              <span className="handle">{request.to.handle}</span>
              <span className="row-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Withdraw request to ${request.to.handle}`}
                  onClick={() => void store.withdrawRequest(request.id)}
                >
                  <UserMinus aria-hidden="true" size={18} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Rail() {
  const { layout, friendsPanelOpen } = useApp();
  const close = (): void => store.setFriendsPanel(false);
  const dialogRef = useDialog(layout === 'narrow' && friendsPanelOpen, close);

  if (layout === 'narrow') {
    if (!friendsPanelOpen) return null;
    return (
      <div className="panel-backdrop">
        <div
          className="panel rail-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Friends"
          ref={dialogRef}
        >
          <div className="panel-head">
            <h2>Friends</h2>
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
          <RailBody />
        </div>
      </div>
    );
  }

  return (
    <aside className="rail" aria-label="Friends">
      <h2 className="rail-title">Friends</h2>
      <RailBody />
    </aside>
  );
}
