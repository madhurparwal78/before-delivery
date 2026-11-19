import { el, t } from './ui.js';
import { api, getJson, type FriendEntry, type FriendRequest, type Invite, type Party, type ChatMessage, type Story } from './api-client.js';
import { store, notify, loadMe, loadParty } from './store.js';
import { languagePickerHtml } from './language.js';
import { navTabs, signOutButton } from './pages-hangar.js';
import { countChars, CHAT_LIMIT } from '../shared/domain.js';
import { locale } from './ui.js';

/**
 * Lobby, party, invite and chat (DP-35 to DP-48, DP-77, DP-78).
 */

export function buildChat(channel: string, opts: { onSend?: (body: string, clientMessageId: string) => Promise<number> } = {}): {
  box: HTMLElement;
  drawer: HTMLElement;
  openDrawerButton: HTMLElement;
} {
  const log = el('div', { role: 'log', 'aria-label': t('controls', 'messages'), class: 'chat-log', id: `chat-log-${channel}` });
  const input = el('input', { type: 'text', id: `chat-input-${channel}`, class: 'chat-input' });
  input.setAttribute('aria-describedby', `chat-counter-${channel}`);
  const counter = el('span', { id: `chat-counter-${channel}`, class: 'counter', text: `0/${CHAT_LIMIT}` });
  const status = el('div', { id: `chat-status-${channel}`, role: 'status', 'aria-live': 'polite', class: 'polite-region chat-status', 'aria-label': t('controls', 'chat-status') });
  const send = el('button', { class: 'primary', text: t('controls', 'send') });
  const box = el('div', { class: 'chat-box', 'aria-label': t('controls', 'chat') });
  box.append(log, input, counter, send, status);

  const syncCounter = () => {
    counter.textContent = `${countChars(input.value)}/${CHAT_LIMIT}`;
    const over = countChars(input.value) > CHAT_LIMIT;
    counter.classList.toggle('over', over);
    if (over) status.textContent = t('copy', 'chat-limit');
    else if (status.textContent === t('copy', 'chat-limit')) status.textContent = '';
  };
  input.addEventListener('input', syncCounter);

  const submit = async () => {
    const body = input.value.trim();
    if (countChars(body) < 1) return;
    if (countChars(body) > CHAT_LIMIT) {
      status.textContent = t('copy', 'chat-limit');
      return;
    }
    const clientMessageId = `${channel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (opts.onSend) {
      send.disabled = true;
      send.textContent = t('copy', 'working');
      const status_ = await opts.onSend(body, clientMessageId);
      send.disabled = false;
      send.textContent = t('controls', 'send');
      if (status_ === 201 || status_ === 200) {
        input.value = '';
        syncCounter();
      }
    } else {
      const result = await api<{ message: ChatMessage }>('POST', `/api/chat/${channel}/messages`, { client_message_id: clientMessageId, body });
      if (result.status === 201) {
        input.value = '';
        syncCounter();
      } else if (result.status === 429) {
        const retry = Number(result.retryAfter ?? 1);
        status.textContent = t('copy', 'chat-cooldown', { seconds: retry });
      } else if (result.status === 422) {
        status.textContent = t('copy', 'chat-limit');
      }
    }
  };
  send.addEventListener('click', () => void submit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  });

  const render = (messages: ChatMessage[]) => {
    log.replaceChildren();
    for (const message of messages) {
      const line = el('div', { class: `chat-line ${message.kind}` });
      if (message.kind === 'system') {
        line.textContent = message.text;
      } else {
        line.textContent = `${message.author?.display_name ?? ''}: ${message.body ?? ''}`;
      }
      log.append(line);
    }
  };

  const drawer = el('div', { class: 'chat-drawer', role: 'dialog', 'aria-label': t('controls', 'chat'), hidden: true });
  const openDrawerButton = el('button', { class: 'ghost chat-drawer-button', text: t('controls', 'open-chat') });
  const closeDrawer = el('button', { class: 'ghost', text: t('controls', 'close-chat') });
  drawer.append(closeDrawer, log.cloneNode(true), input.cloneNode(true) as HTMLInputElement, counter.cloneNode(true), send.cloneNode(true) as HTMLButtonElement, status.cloneNode(true));

  void (async () => {
    const res = await getJson<{ messages: ChatMessage[] }>(`/api/chat/${channel}/messages?after_seq=0`);
    render(res?.messages ?? []);
  })();

  return { box, drawer, openDrawerButton };
}

export async function mountLobby(): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/lobby'));
  const main = el('section', { class: 'page-main lobby-main' });
  main.append(el('h1', { class: 'screen-heading', text: t('copy', 'lobby-heading') }));

  const friendsBox = el('div', { class: 'panel' });
  const friendsList = el('div', { role: 'list', 'aria-label': t('controls', 'friends'), class: 'friends-list' });
  const friendForm = el('form', { class: 'friend-form' });
  const friendName = el('input', { type: 'text', 'aria-label': t('controls', 'friend-display-name'), id: 'friend-display-name' });
  const friendSubmit = el('button', { type: 'submit', class: 'primary', text: t('controls', 'send-friend-request') });
  friendForm.append(friendName, friendSubmit);
  const requestsBox = el('div', { class: 'panel' });
  const incomingList = el('div', { class: 'request-list' });

  friendForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const requestId = `fr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await api('POST', '/api/friends/requests', { display_name: friendName.value, client_request_id: requestId });
    if (result.status === 201) notify(t('copy', 'friend-request-sent', { name: friendName.value }));
    else if (result.status === 409) {
      const data = result.data as { error?: { code?: string } } | null;
      const code = data?.error?.code;
      notify(t('copy', code === 'already_friends' ? 'already-friends' : code === 'request_pending' ? 'request-pending' : 'already-in-party'));
    } else if (result.status === 403) {
      notify(t('copy', 'email-unverified'));
    } else {
      notify(t('copy', 'no-such-player'));
    }
    friendName.value = '';
  });

  const invitesBox = el('div', { class: 'panel' });
  const invitesList = el('div', { class: 'invite-list' });

  const createParty = el('button', { class: 'primary', text: t('controls', 'create-party') });
  const storySelect = el('select', { 'aria-label': t('controls', 'coop-story'), id: 'coop-story' }) as HTMLSelectElement;
  const storiesRes = await getJson<{ stories: Story[] }>('/api/stories');
  const coopStories = (storiesRes?.stories ?? []).filter((s) => s.mode === 'coop');
  for (const story of coopStories) {
    const option = el('option', { value: story.id, text: story.title });
    storySelect.append(option);
  }
  createParty.addEventListener('click', async () => {
    createParty.disabled = true;
    createParty.textContent = t('copy', 'working');
    const result = await api<{ party: Party }>('POST', '/api/parties', { story_id: storySelect.value });
    if (result.status === 201 && result.data?.party) {
      location.href = `/party/${result.data.party.id}`;
    } else {
      createParty.disabled = false;
      createParty.textContent = t('controls', 'create-party');
      notify(t('copy', 'already-in-party'));
    }
  });

  const refreshFriends = async () => {
    const res = await getJson<{ friends: FriendEntry[]; incoming: FriendRequest[] }>('/api/friends');
    friendsList.replaceChildren();
    for (const friend of res?.friends ?? []) {
      const item = el('div', { class: 'friend-item', role: 'listitem' });
      item.append(el('span', { text: friend.display_name }));
      item.append(el('span', { class: `presence ${friend.presence}`, text: t('copy', friend.presence === 'online' ? 'presence-online' : 'presence-offline') }));
      friendsList.append(item);
    }
    if ((res?.friends ?? []).length === 0) friendsList.append(el('p', { text: t('copy', 'no-friends') }));
    incomingList.replaceChildren();
    for (const request of res?.incoming ?? []) {
      const item = el('div', { class: 'request-item' });
      const accept = el('button', { class: 'ghost', text: t('controls', 'accept', { name: request.from.display_name }) });
      const decline = el('button', { class: 'ghost', text: t('controls', 'decline', { name: request.from.display_name }) });
      accept.addEventListener('click', async () => {
        await api('POST', `/api/friends/requests/${request.id}/accept`);
        notify(t('copy', 'friends-now', { name: request.from.display_name }));
        void refreshFriends();
      });
      decline.addEventListener('click', async () => {
        await api('POST', `/api/friends/requests/${request.id}/decline`);
        void refreshFriends();
      });
      item.append(accept, decline);
      incomingList.append(item);
    }
    if ((res?.incoming ?? []).length === 0) incomingList.append(el('p', { text: t('copy', 'no-requests') }));
  };
  await refreshFriends();

  const refreshInvites = async () => {
    const res = await getJson<{ invites: Invite[] }>('/api/invites');
    invitesList.replaceChildren();
    for (const invite of res?.invites ?? []) {
      const item = el('div', { class: 'invite-item' });
      const link = el('a', { href: `/invite/${invite.token}`, text: t('copy', 'invite-page-heading', { name: invite.from.display_name }) });
      item.append(link);
      invitesList.append(item);
    }
    if ((res?.invites ?? []).length === 0) invitesList.append(el('p', { text: t('copy', 'no-invites') }));
  };
  await refreshInvites();

  friendsBox.append(el('h2', { text: t('copy', 'friends-heading') }), friendsList, el('h3', { text: t('copy', 'requests-heading') }), incomingList, friendForm);
  requestsBox.append(el('h2', { text: t('copy', 'requests-heading') }));
  invitesBox.append(el('h2', { text: t('copy', 'invites-heading') }), invitesList);
  const chat = buildChat('lobby');

  const partyPanel = el('div', { class: 'panel' });
  partyPanel.append(el('h2', { text: t('copy', 'party-in') }));
  const currentParty = el('a', { href: '#', text: t('copy', 'party-in'), hidden: true });
  partyPanel.append(currentParty);
  await loadParty();
  if (store.party) {
    currentParty.hidden = false;
    currentParty.href = `/party/${store.party.id}`;
  }

  main.append(friendsBox, invitesBox, partyPanel, el('div', { class: 'panel' }, storySelect, createParty), chat.box, languagePickerHtml(), signOutButton());
  root.append(layout, main);
}

export async function mountParty(partyId: string): Promise<void> {
  await loadMe();
  await loadParty();
  const root = document.getElementById('root');
  if (!root) return;
  const res = await getJson<{ party: Party }>(`/api/parties/${partyId}`);
  const party = res?.party;
  if (!party) {
    location.href = '/lobby';
    return;
  }
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/lobby'));
  const main = el('section', { class: 'page-main party-main' });
  main.append(el('h1', { class: 'screen-heading', text: t('copy', 'party-lobby-heading') }));

  const membersList = el('div', { role: 'list', 'aria-label': t('controls', 'party-members'), class: 'party-members' });
  const friendsRes = await getJson<{ friends: FriendEntry[] }>('/api/friends');
  const inviteRow = el('div', { class: 'invite-row' });
  const storySelect = el('select', { 'aria-label': t('controls', 'coop-story'), id: 'party-story' }) as HTMLSelectElement;
  const storiesRes = await getJson<{ stories: Story[] }>('/api/stories');
  for (const story of (storiesRes?.stories ?? []).filter((s) => s.mode === 'coop')) {
    storySelect.append(el('option', { value: story.id, text: story.title }));
  }
  storySelect.value = party.story_id;

  const isLeader = store.account?.id === party.leader_id;
  let lastCheck: Party['ready_check'] = null;

  const renderMembers = (current: Party) => {
    membersList.replaceChildren();
    for (const member of current.members) {
      const item = el('div', { class: 'party-member', role: 'listitem' });
      item.append(el('span', { text: member.display_name }));
      if (member.account_id === current.leader_id) {
        item.append(el('span', { class: 'leader-mark', text: t('copy', 'leader-mark') }));
      }
      if (member.connection === 'dropped') {
        item.append(el('span', { class: 'seat-held', text: t('copy', 'seat-held', { seconds: member.grace_remaining_seconds ?? 0 }) }));
      } else {
        item.append(el('span', { class: `presence ${member.connection}`, text: t('copy', member.connection === 'connected' ? 'presence-online' : 'presence-offline') }));
      }
      membersList.append(item);
    }
  };

  const renderInvites = () => {
    inviteRow.replaceChildren();
    if (!isLeader) return;
    const inParty = new Set(party?.members.map((m) => m.account_id) ?? []);
    for (const friend of friendsRes?.friends ?? []) {
      if (inParty.has(friend.account_id)) continue;
      const invite = el('button', { class: 'ghost', text: t('controls', 'invite', { name: friend.display_name }) });
      invite.addEventListener('click', async () => {
        invite.disabled = true;
        const result = await api('POST', `/api/parties/${partyId}/invites`, { account_id: friend.account_id });
        invite.disabled = false;
        if (result.status === 201) notify(t('copy', 'friend-request-sent', { name: friend.display_name }));
        else notify(t('copy', 'party-full'));
      });
      inviteRow.append(invite);
    }
  };

  const readyDialog = el('div', { class: 'modal-backdrop', hidden: true });
  const readyPanel = el('div', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('controls', 'ready-check'), class: 'modal-panel ready-panel' });
  const timer = el('div', { role: 'timer', 'aria-label': t('controls', 'time-left'), class: 'ready-timer', id: 'ready-timer' });
  const readyButton = el('button', { class: 'primary', text: t('controls', 'ready') });
  const notReadyButton = el('button', { class: 'ghost', text: t('controls', 'not-ready') });
  readyPanel.append(el('h2', { text: t('controls', 'ready-check') }), timer, readyButton, notReadyButton);
  readyDialog.append(readyPanel);
  let focusBeforeDialog: HTMLElement | null = null;

  const openReadyDialog = (check: Party['ready_check'], answered: boolean) => {
    lastCheck = check;
    if (!check) return;
    timer.textContent = t('copy', 'ready-timer', { seconds: check.remaining_seconds });
    readyButton.disabled = answered;
    notReadyButton.disabled = answered;
    if (readyDialog.hidden) {
      focusBeforeDialog = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      readyDialog.hidden = false;
      readyButton.focus();
    }
  };
  const closeReadyDialog = () => {
    readyDialog.hidden = true;
    if (focusBeforeDialog && document.body.contains(focusBeforeDialog)) focusBeforeDialog.focus();
    else (isLeader ? startCheckButton : openCheckButton)?.focus();
  };
  readyButton.addEventListener('click', async () => {
    readyButton.disabled = true;
    notReadyButton.disabled = true;
    await api('POST', `/api/parties/${partyId}/ready-check/response`, { ready: true });
  });
  notReadyButton.addEventListener('click', async () => {
    readyButton.disabled = true;
    notReadyButton.disabled = true;
    await api('POST', `/api/parties/${partyId}/ready-check/response`, { ready: false });
  });
  readyDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReadyDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const first: HTMLElement = readyButton;
    const last: HTMLElement = notReadyButton;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const startCheckButton = el('button', { class: 'primary', text: t('controls', 'start-ready-check') });
  const openCheckButton = el('button', { class: 'primary', text: t('controls', 'open-ready-check'), hidden: true });
  startCheckButton.addEventListener('click', async () => {
    const result = await api<{ party: Party }>('POST', `/api/parties/${partyId}/ready-check`);
    if (result.status === 201 && result.data?.party?.ready_check) {
      openReadyDialog(result.data.party.ready_check, false);
    } else if (result.status === 409) {
      const data = result.data as { error?: { code?: string } } | null;
      if (data?.error?.code === 'not_enough_members') notify(t('copy', 'too-few-members'));
      else notify(t('copy', 'generic-error'));
    }
  });
  openCheckButton.addEventListener('click', () => {
    if (lastCheck) openReadyDialog(lastCheck, store.account ? lastCheck.responses[store.account.id] !== 'pending' : false);
  });

  const leaveButton = el('button', { class: 'ghost', text: t('controls', 'leave-party') });
  leaveButton.addEventListener('click', async () => {
    await api('POST', `/api/parties/${partyId}/leave`);
    location.href = '/lobby';
  });

  const render = (current: Party) => {
    renderMembers(current);
    renderInvites();
    const checkRunning = current.status === 'ready_check' && current.ready_check;
    startCheckButton.hidden = !isLeader || Boolean(checkRunning);
    openCheckButton.hidden = isLeader || !checkRunning;
    if (checkRunning) {
      const answered = store.account ? current.ready_check?.responses[store.account.id] !== 'pending' : false;
      openReadyDialog(current.ready_check, answered);
    } else if (!readyDialog.hidden) {
      closeReadyDialog();
    }
    if (current.status === 'in_session' && current.session_id) {
      location.href = `/play/${current.session_id}`;
    }
  };
  render(party);

  main.append(membersList, inviteRow, storySelect, startCheckButton, openCheckButton, leaveButton, languagePickerHtml(), signOutButton());
  root.append(layout, main, readyDialog);

  const chat = buildChat(`party-${partyId}`);
  main.append(chat.box);

  const { onEvent, openRealtime, followParty } = await import('./realtime-client.js');
  followParty(partyId);
  onEvent((message) => {
    if (message.type === 'state' && message.party) {
      const next = message.party as Party;
      store.party = next;
      render(next);
    }
  });
  openRealtime();
}

export async function mountInvite(token: string): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  const res = await getJson<{ invites: Invite[] }>('/api/invites');
  const invite = (res?.invites ?? []).find((i) => i.token === token);
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/lobby'));
  const main = el('section', { class: 'page-main' });
  const heading = el('h1', { class: 'screen-heading', text: t('screens', 'invite') });
  main.append(heading);
  if (invite) {
    main.append(el('p', { text: t('copy', 'invite-from', { name: invite.from.display_name }) }));
    const storiesRes = await getJson<{ stories: Story[] }>('/api/stories');
    const story = (storiesRes?.stories ?? []).find((s) => s.id === invite.story_id);
    if (story) main.append(el('p', { text: story.title }));
    main.append(el('p', { text: `${t('copy', 'invite-story')}: ${invite.member_count}` }));
    const join = el('button', { class: 'primary', text: t('controls', 'join-party') });
    join.addEventListener('click', async () => {
      join.disabled = true;
      join.textContent = t('copy', 'working');
      const result = await api<{ party: Party }>('POST', `/api/invites/${token}/accept`);
      if (result.status === 200 && result.data?.party) {
        location.href = `/party/${result.data.party.id}`;
      } else {
        join.disabled = false;
        join.textContent = t('controls', 'join-party');
        const data = result.data as { error?: { code?: string } } | null;
        const code = data?.error?.code;
        if (code === 'party_full') notify(t('copy', 'party-full'));
        else if (code === 'already_in_party') notify(t('copy', 'already-in-party'));
        else if (code === 'invite_closed') notify(t('copy', 'invite-closed'));
        else notify(t('copy', 'generic-error'));
      }
    });
    main.append(join);
  } else {
    main.append(el('p', { text: t('copy', 'invite-closed') }));
  }
  main.append(languagePickerHtml(), signOutButton());
  root.append(layout, main);
}
