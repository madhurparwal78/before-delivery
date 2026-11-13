import { ApiFailure, api } from '../api.js';
import { clear, el, trapFocus } from '../dom.js';
import { chatForViewport } from '../chat.js';
import { realtime } from '../realtime.js';
import { withPending, type AppContext, type Screen } from './shared.js';
import { STORIES } from '../../shared/constants.js';
import type { MessageKey } from '../../shared/i18n/index.js';
import type { FriendEntry, FriendRequest, Party } from '../../shared/types.js';

interface InviteEntry {
  token: string;
  party_id: string;
  from: string;
  story_id: string;
  member_count: number;
}

const COOP_STORIES = STORIES.filter((story) => story.mode === 'coop');

function storyTitle(ctx: AppContext, storyId: string): string {
  return ctx.t(`story.${storyId}` as MessageKey);
}

export async function renderLobby(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  const page = el('div', { class: 'page lobby-page' });
  const chat = chatForViewport(ctx, 'lobby');

  const friendsList = el('ul', {
    class: 'friends',
    role: 'list',
    'aria-label': ctx.t('list.friends'),
  });
  const incomingHost = el('div', { class: 'requests' });
  const invitesHost = el('div', { class: 'invites' });

  const nameInput = el('input', {
    type: 'text',
    id: 'friend-name',
    'aria-label': ctx.t('field.friendName'),
  }) as HTMLInputElement;
  const nameError = el('p', { class: 'field-error' });
  const sendRequest = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.sendFriendRequest'),
  ]) as HTMLButtonElement;

  const createParty = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.createParty'),
  ]) as HTMLButtonElement;

  // Only the most recently started read is drawn, so a slow older answer never hides a newer one.
  let loads = 0;
  const load = async (): Promise<boolean> => {
    loads += 1;
    const mine = loads;
    const [{ friends, incoming }, { invites }] = await Promise.all([
      api.get<{ friends: FriendEntry[]; incoming: FriendRequest[] }>('/api/friends'),
      api.get<{ invites: InviteEntry[] }>('/api/invites'),
    ]);
    if (mine !== loads) return false;

    clear(friendsList);
    if (friends.length === 0) {
      friendsList.append(el('li', { text: ctx.t('lobby.noFriends') }));
    }
    for (const friend of friends) {
      friendsList.append(
        el('li', {}, [
          el('span', { text: friend.display_name }),
          el('span', {
            class: 'presence',
            text: ctx.t(friend.presence === 'online' ? 'presence.online' : 'presence.offline'),
          }),
        ]),
      );
    }

    clear(incomingHost);
    if (incoming.length > 0) {
      incomingHost.append(el('h2', { text: ctx.t('lobby.incoming') }));
      for (const request of incoming) {
        const accept = el('button', { type: 'button', class: 'button' }, [
          ctx.t('btn.accept', { name: request.from.display_name }),
        ]) as HTMLButtonElement;
        const decline = el('button', { type: 'button', class: 'button' }, [
          ctx.t('btn.decline', { name: request.from.display_name }),
        ]) as HTMLButtonElement;
        accept.addEventListener('click', () => {
          void withPending(ctx, accept, async () => {
            await api.post(`/api/friends/requests/${request.id}/accept`);
            ctx.announce(ctx.t('fb.friendsNow', { name: request.from.display_name }));
            await load();
          });
        });
        decline.addEventListener('click', () => {
          void withPending(ctx, decline, async () => {
            await api.post(`/api/friends/requests/${request.id}/decline`);
            await load();
          });
        });
        incomingHost.append(el('div', { class: 'request-row' }, [accept, decline]));
      }
    }

    clear(invitesHost);
    if (invites.length > 0) {
      invitesHost.append(el('h2', { text: ctx.t('lobby.invites') }));
      for (const invite of invites) {
        invitesHost.append(
          el('p', {}, [
            el('a', {
              href: `/invite/${invite.token}`,
              text: ctx.t('lobby.inviteLink', { name: invite.from }),
            }),
            el('span', { text: ` · ${storyTitle(ctx, invite.story_id)}` }),
          ]),
        );
      }
    }
    return true;
  };

  sendRequest.addEventListener('click', () => {
    void withPending(ctx, sendRequest, async () => {
      nameError.textContent = '';
      try {
        await api.post('/api/friends/requests', {
          display_name: nameInput.value.trim(),
          client_request_id: crypto.randomUUID(),
        });
        ctx.announce(ctx.t('fb.friendRequestSent', { name: nameInput.value.trim() }));
        nameInput.value = '';
        await load();
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          const fieldMessage = failure.fieldMessage('display_name');
          if (fieldMessage !== null) {
            nameError.textContent = fieldMessage;
            return;
          }
          ctx.announce(failure.localisedMessage);
          return;
        }
        ctx.announce(ctx.t('fb.generic'));
      }
    });
  });

  createParty.addEventListener('click', () => {
    void withPending(ctx, createParty, async () => {
      try {
        const { party } = await api.post<{ party: Party }>('/api/parties', {
          story_id: COOP_STORIES[0].id,
        });
        ctx.navigate(`/party/${party.id}`);
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          ctx.announce(failure.localisedMessage);
          return;
        }
        ctx.announce(ctx.t('fb.generic'));
      }
    });
  });

  page.append(
    el('h1', { text: ctx.t('nav.lobby') }),
    el('div', { class: 'lobby-columns' }, [
      el('div', { class: 'paper-card' }, [
        el('h2', { text: ctx.t('list.friends') }),
        friendsList,
        el('label', { class: 'field', for: 'friend-name' }, [
          el('span', { text: ctx.t('field.friendName') }),
          nameInput,
          nameError,
        ]),
        sendRequest,
        incomingHost,
        invitesHost,
        createParty,
      ]),
      chat.element,
    ]),
  );

  // Listening starts before the first read, so nothing that happens during it is missed.
  const offEvent = realtime.onEvent((event) => {
    const kind = event.event.kind;
    if (kind === 'presence' || kind === 'friend_request' || kind === 'friend_added' || kind === 'invite') {
      void load();
    }
  });
  const offOpen = realtime.onOpen(() => void load());
  // A read that a newer one overtook draws nothing, so read again until one has drawn.
  let drawn = false;
  while (!drawn) drawn = await load();
  // The page goes on screen with its first read in place, so the lists never push the form down.
  host.append(page);

  return {
    destroy: (): void => {
      offEvent();
      offOpen();
      chat.destroy();
    },
  };
}

export async function renderParty(
  ctx: AppContext,
  host: HTMLElement,
  partyId: string,
): Promise<Screen> {
  let party: Party;
  try {
    party = (await api.get<{ party: Party }>(`/api/parties/${partyId}`)).party;
  } catch {
    ctx.navigate('/lobby', { replace: true });
    return {};
  }

  const { friends } = await api.get<{ friends: FriendEntry[] }>('/api/friends');
  const chat = chatForViewport(ctx, `party-${partyId}`);
  const membersList = el('ul', {
    class: 'party-members',
    role: 'list',
    'aria-label': ctx.t('list.partyMembers'),
  });
  const storySelect = el('select', { 'aria-label': ctx.t('combo.coopStory') }) as HTMLSelectElement;
  for (const story of COOP_STORIES) {
    storySelect.append(el('option', { value: story.id }, [storyTitle(ctx, story.id)]));
  }
  const inviteHost = el('div', { class: 'invite-buttons' });
  const leaderHost = el('div', { class: 'leader-buttons' });
  const readyHost = el('div', { class: 'ready-controls' });
  const leaveButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.leaveParty'),
  ]) as HTMLButtonElement;

  const page = el('div', { class: 'page party-page' }, [
    el('h1', { text: ctx.t('title.party') }),
    el('div', { class: 'party-columns' }, [
      el('div', { class: 'paper-card' }, [
        membersList,
        storySelect,
        inviteHost,
        leaderHost,
        readyHost,
        leaveButton,
      ]),
      chat.element,
    ]),
  ]);
  host.append(page);

  // The ready-check controls persist across party states, so focus can always return to them.
  const startButton = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.startReadyCheck'),
  ]) as HTMLButtonElement;
  const openButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.openReadyCheck'),
  ]) as HTMLButtonElement;
  readyHost.append(startButton, openButton);
  startButton.addEventListener('click', () => {
    if (party.ready_check !== null) {
      openDialog();
      return;
    }
    void withPending(ctx, startButton, async () => {
      try {
        const response = await api.post<{ party: Party }>(`/api/parties/${partyId}/ready-check`);
        applyParty(response.party);
      } catch (failure) {
        ctx.announce(
          failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
        );
      }
    });
  });
  openButton.addEventListener('click', () => openDialog());

  let dialog: HTMLElement | null = null;
  let autoOpenedFor: number | null = null;
  let timerNode: HTMLElement | null = null;
  let answered = false;
  let openerFallback: 'start' | 'open' = 'open';
  let previousFocus: HTMLElement | null = null;
  let leftForSession = false;

  const isLeader = (): boolean => party.leader_id === ctx.account?.id;

  const closeDialog = (): void => {
    dialog?.remove();
    dialog = null;
    timerNode = null;
    const fallback = openerFallback === 'start' ? startButton : openButton;
    const target =
      previousFocus !== null && previousFocus !== document.body && previousFocus.isConnected
        ? previousFocus
        : fallback;
    target.focus();
  };

  const answer = (ready: boolean, buttons: HTMLButtonElement[]): void => {
    answered = true;
    for (const button of buttons) button.disabled = true;
    void (async () => {
      try {
        const response = await api.post<{ party: Party }>(
          `/api/parties/${partyId}/ready-check/response`,
          { ready },
        );
        applyParty(response.party);
      } catch (failure) {
        ctx.announce(
          failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
        );
      }
    })();
  };

  const openDialog = (): void => {
    if (dialog !== null || party.ready_check === null) return;
    previousFocus = document.activeElement as HTMLElement | null;
    openerFallback = isLeader() ? 'start' : 'open';
    const ready = el('button', { type: 'button', class: 'button primary' }, [
      ctx.t('btn.ready'),
    ]) as HTMLButtonElement;
    const notReady = el('button', { type: 'button', class: 'button' }, [
      ctx.t('btn.notReady'),
    ]) as HTMLButtonElement;
    timerNode = el('div', {
      class: 'timer',
      role: 'timer',
      'aria-label': ctx.t('timer.timeLeft'),
      text: ctx.t('readyCheck.timer', { seconds: party.ready_check.remaining_seconds }),
    });
    ready.addEventListener('click', () => answer(true, [ready, notReady]));
    notReady.addEventListener('click', () => answer(false, [ready, notReady]));
    const node = el('div', {
      class: 'dialog paper-card',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': ctx.t('dialog.readyCheck'),
    }, [
      el('h2', { text: ctx.t('dialog.readyCheck') }),
      timerNode,
      el('div', { class: 'dialog-actions' }, [ready, notReady]),
    ]);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      trapFocus(node, event);
    });
    dialog = node;
    host.append(node);
    const mine = party.ready_check.responses[ctx.account?.id ?? ''] ?? 'pending';
    if (mine === 'pending' && !answered) {
      ready.focus();
    } else {
      ready.disabled = true;
      notReady.disabled = true;
    }
  };

  function applyParty(next: Party): void {
    party = next;

    clear(membersList);
    for (const member of party.members) {
      membersList.append(
        el('li', {}, [
          el('span', { class: 'member-name', text: member.display_name }),
          member.account_id === party.leader_id
            ? el('span', { class: 'badge', text: ctx.t('party.leaderMark') })
            : null,
          member.connection === 'dropped'
            ? el('span', {
                class: 'seat-held',
                text: ctx.t('roster.seatHeld', {
                  seconds: member.grace_remaining_seconds ?? 0,
                }),
              })
            : el('span', {
                class: 'presence',
                text: ctx.t(
                  member.connection === 'connected' ? 'presence.online' : 'presence.offline',
                ),
              }),
        ]),
      );
    }

    storySelect.value = party.story_id;
    storySelect.hidden = !isLeader();
    storySelect.disabled = !isLeader() || party.status !== 'forming';

    clear(inviteHost);
    if (isLeader() && party.status === 'forming') {
      for (const friend of friends) {
        if (party.members.some((member) => member.account_id === friend.account_id)) continue;
        const invite = el('button', { type: 'button', class: 'button' }, [
          ctx.t('btn.invite', { name: friend.display_name }),
        ]) as HTMLButtonElement;
        invite.addEventListener('click', () => {
          void withPending(ctx, invite, async () => {
            try {
              await api.post(`/api/parties/${partyId}/invites`, { account_id: friend.account_id });
            } catch (failure) {
              ctx.announce(
                failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
              );
            }
          });
        });
        inviteHost.append(invite);
      }
    }

    clear(leaderHost);
    if (isLeader()) {
      for (const member of party.members) {
        if (member.account_id === ctx.account?.id) continue;
        const handoff = el('button', { type: 'button', class: 'button' }, [
          ctx.t('btn.makeLeader', { name: member.display_name }),
        ]) as HTMLButtonElement;
        handoff.addEventListener('click', () => {
          void withPending(ctx, handoff, async () => {
            await api.post(`/api/parties/${partyId}/leader`, { account_id: member.account_id });
          });
        });
        leaderHost.append(handoff);
      }
    }

    startButton.hidden = !isLeader();
    openButton.hidden = isLeader() || party.ready_check === null;

    if (party.ready_check === null) {
      answered = false;
      if (dialog !== null) {
        dialog.remove();
        dialog = null;
        timerNode = null;
      }
    } else {
      // The dialog opens by itself once per check (when it starts or the page loads); Escape keeps it closed.
      if (autoOpenedFor !== party.ready_check.deadline_at) {
        autoOpenedFor = party.ready_check.deadline_at;
        openDialog();
      }
      if (timerNode !== null) {
        timerNode.textContent = ctx.t('readyCheck.timer', {
          seconds: party.ready_check.remaining_seconds,
        });
      }
    }

    if (
      !leftForSession &&
      party.session_id !== null &&
      (party.status === 'in_session' || party.status === 'member_dropped')
    ) {
      leftForSession = true;
      ctx.navigate(`/play/${party.session_id}`);
    }
  }

  storySelect.addEventListener('change', () => {
    void api.patch(`/api/parties/${partyId}`, { story_id: storySelect.value });
  });

  leaveButton.addEventListener('click', () => {
    void withPending(ctx, leaveButton, async () => {
      await api.post(`/api/parties/${partyId}/leave`);
      ctx.navigate('/lobby');
    });
  });

  const offState = realtime.onState((next) => {
    if (next.id === partyId) applyParty(next);
  });

  applyParty(party);

  return {
    destroy: (): void => {
      offState();
      chat.destroy();
      dialog?.remove();
    },
  };
}

export async function renderInvite(
  ctx: AppContext,
  host: HTMLElement,
  token: string,
): Promise<Screen> {
  const { invites } = await api.get<{ invites: InviteEntry[] }>('/api/invites');
  const invite = invites.find((entry) => entry.token === token) ?? null;
  const card = el('div', { class: 'page paper-card' });
  host.append(card);

  if (invite === null) {
    card.append(el('h1', { text: ctx.t('fb.inviteClosed') }));
    return {};
  }

  const join = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.joinParty'),
  ]) as HTMLButtonElement;
  join.addEventListener('click', () => {
    void withPending(ctx, join, async () => {
      try {
        const { party } = await api.post<{ party: Party }>(`/api/invites/${token}/accept`);
        ctx.navigate(`/party/${party.id}`);
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          ctx.announce(failure.localisedMessage);
          return;
        }
        ctx.announce(ctx.t('fb.generic'));
      }
    });
  });

  card.append(
    el('h1', {
      text: ctx.t('invite.heading', {
        name: invite.from,
        story: storyTitle(ctx, invite.story_id),
      }),
    }),
    el('p', { text: ctx.t('invite.story', { story: storyTitle(ctx, invite.story_id) }) }),
    el('p', { text: ctx.t('party.memberCount', { n: invite.member_count }) }),
    join,
  );
  return {};
}
