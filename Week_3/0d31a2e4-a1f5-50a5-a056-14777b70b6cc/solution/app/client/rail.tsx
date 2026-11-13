// The Friends rail: your party group, friends with presence, the add-friend field and requests.
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { CircleUser, UserPlus } from "lucide";
import { ApiFailure, post, remove } from "./api.js";
import { Bean } from "./bean.js";
import { COPY, PRESENCE_TEXT } from "./copy.js";
import { Icon } from "./icon.js";
import { announce, announceFailure } from "./notices.js";
import { friends, invites, me, party, refreshFriends } from "./state.js";
import { useStore } from "./store.js";
import { ActionButton, useAction } from "./ui.js";
import type { User } from "../shared/api.js";
import type { Presence } from "../shared/rules.js";

function PresenceDot({ presence }: { presence: Presence }) {
  return (
    <span class="presence">
      <span class={`dot ${presence}`} aria-hidden="true" />
      <span class="visually-hidden">{PRESENCE_TEXT[presence]}</span>
    </span>
  );
}

function openConversation(userId: number): void {
  window.dispatchEvent(new CustomEvent<number>("pc:open-dm", { detail: userId }));
}

function FriendRow({ user, presence, canInvite }: { user: User; presence: Presence; canInvite: boolean }) {
  return (
    <li class="person" data-user-id={user.id} data-presence={presence}>
      <Bean userId={user.id} />
      <div class="person-name">
        <a class="handle" href={`/u/${user.handle}`}>{user.handle}</a>
        <PresenceDot presence={presence} />
      </div>
      <div class="person-actions">
        {canInvite ? (
          <ActionButton label="Invite" ariaLabel={`Invite ${user.handle} to party`} kind="quiet" run={async () => {
            try {
              await post("/api/party/invites", { userId: user.id });
              announce(COPY.inviteSent(user.handle));
            } catch (error) {
              announceFailure(error, {
                party_full: COPY.partyFull, party_busy: COPY.partyBusy, not_leader: COPY.leaderOnly, not_friends: COPY.friendsOnly,
                already_in_party: COPY.cannotNow,
              });
            }
          }} />
        ) : null}
        <button type="button" class="button quiet" aria-label={`Message ${user.handle}`} onClick={() => openConversation(user.id)}>
          Message
        </button>
      </div>
    </li>
  );
}

function AddFriend() {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useAction();
  const errorId = "add-friend-error";
  const submit = (event: JSX.TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const wanted = handle.trim().toLowerCase();
    setError(null);
    void run(async () => {
      try {
        const result = await post<{ request?: unknown; friendship?: unknown }>("/api/friends/requests", { handle: wanted });
        announce(result.friendship === undefined ? COPY.requestSent(wanted) : COPY.nowFriends(wanted));
        setHandle("");
        await refreshFriends();
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.code === "validation_failed") {
          setError(failure.fields["handle"] ?? COPY.notYourself);
          announce(COPY.checkFields);
          return;
        }
        announceFailure(failure, { user_not_found: COPY.noPlayer(wanted), already_friends: COPY.alreadyFriends(wanted), blocked: COPY.cantAdd });
      }
    });
  };
  return (
    <form class="add-friend" onSubmit={submit}>
      <label class="visually-hidden" for="add-friend">Add friend by handle</label>
      <input id="add-friend" type="text" placeholder="Add friend by handle" autocomplete="off" spellcheck={false} value={handle}
        aria-invalid={error === null ? undefined : "true"} aria-describedby={error === null ? undefined : errorId}
        onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => setHandle(event.currentTarget.value)} />
      {error === null ? null : <p class="field-error" id={errorId}>{error}</p>}
      <button type="submit" class="button primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
        <Icon node={UserPlus} />
        <span>{pending ? COPY.sending : "Send request"}</span>
      </button>
    </form>
  );
}

function Requests() {
  const view = useStore(friends);
  const incoming = view?.incoming ?? [];
  const outgoing = view?.outgoing ?? [];
  const closed = { request_not_found: COPY.requestClosed };
  return (
    <section class="rail-section requests" aria-labelledby="requests-title">
      <h3 id="requests-title">Requests</h3>
      <ul aria-label="Requests" class="people">
        {incoming.map((request) => (
          <li key={`in-${request.id}`} class="person" data-user-id={request.from.id}>
            <Bean userId={request.from.id} />
            <div class="person-name"><span class="handle">{request.from.handle}</span><span class="note">wants to be friends</span></div>
            <div class="person-actions">
              <ActionButton label="Accept" ariaLabel={`Accept ${request.from.handle}`} kind="primary" run={async () => {
                try {
                  await post(`/api/friends/requests/${request.id}/accept`);
                  announce(COPY.nowFriends(request.from.handle));
                  await refreshFriends();
                } catch (error) {
                  announceFailure(error, closed);
                }
              }} />
              <ActionButton label="Decline" ariaLabel={`Decline ${request.from.handle}`} kind="quiet" run={async () => {
                try {
                  await post(`/api/friends/requests/${request.id}/decline`);
                  announce(COPY.declined);
                  await refreshFriends();
                } catch (error) {
                  announceFailure(error, closed);
                }
              }} />
            </div>
          </li>
        ))}
        {outgoing.map((request) => (
          <li key={`out-${request.id}`} class="person" data-user-id={request.to.id}>
            <Bean userId={request.to.id} />
            <div class="person-name"><span class="handle">{request.to.handle}</span><span class="note">request sent</span></div>
            <div class="person-actions">
              <ActionButton label="Withdraw" ariaLabel={`Withdraw request to ${request.to.handle}`} kind="quiet" run={async () => {
                try {
                  await remove(`/api/friends/requests/${request.id}`);
                  announce(COPY.withdrawn);
                  await refreshFriends();
                } catch (error) {
                  announceFailure(error, closed);
                }
              }} />
            </div>
          </li>
        ))}
      </ul>
      {incoming.length + outgoing.length === 0 ? <p class="empty">No open requests.</p> : null}
    </section>
  );
}

function ProfileLink({ handle }: { handle: string }) {
  return <a class="profile-link" href={`/u/${handle}`}><Icon node={CircleUser} /><span>Your profile</span></a>;
}

export function RailContent() {
  const self = useStore(me);
  const view = useStore(friends);
  const current = useStore(party);
  useStore(invites);
  if (self === null || self === undefined) return null;
  if (!self.emailVerified) {
    return (
      <>
        <AddFriend />
        <p class="locked">Friends unlock once your email is verified.</p>
        <ProfileLink handle={self.handle} />
      </>
    );
  }
  const memberIds = new Set(current?.members.map((member) => member.user.id) ?? []);
  const presenceOf = new Map(view?.friends.map((entry) => [entry.user.id, entry.presence]) ?? []);
  const leading = current?.leaderId === self.id;
  const others = (view?.friends ?? []).filter((entry) => !memberIds.has(entry.user.id));
  // The add-friend field and Your profile come first in Tab order; the stylesheet shows them below the lists.
  return (
    <>
      <AddFriend />
      <ProfileLink handle={self.handle} />
      <section class="rail-section party-group" aria-labelledby="party-group-title">
        <h3 id="party-group-title">In your party</h3>
        <ul aria-label="In your party" class="people">
          {(current?.members ?? []).map(({ user }) => (
            <li key={user.id} class="person" data-user-id={user.id}>
              <Bean userId={user.id} />
              <div class="person-name">
                <span class="handle">{user.handle}</span>
                {user.id === self.id ? <span class="you">{" (you)"}</span> : null}
                {user.id === current?.leaderId ? <span class="badge">Leader</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section class="rail-section friend-group" aria-labelledby="friend-list-title">
        <h3 id="friend-list-title" class="visually-hidden">Friend list</h3>
        <ul aria-label="Friends" class="people">
          {others.map((entry) => (
            <FriendRow key={entry.user.id} user={entry.user} presence={presenceOf.get(entry.user.id) ?? "offline"} canInvite={leading} />
          ))}
        </ul>
        {view !== null && others.length === 0 ? <p class="empty">Add a friend by their handle to play together.</p> : null}
      </section>
      <Requests />
    </>
  );
}
