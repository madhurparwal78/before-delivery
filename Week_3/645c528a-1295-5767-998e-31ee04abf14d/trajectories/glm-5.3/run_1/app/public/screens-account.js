// Profile, settings, friends panel, verify, invite and add-friend screens.

import { el, api, navigate, fmt, copy } from './ui.js';
import { state, loadMe, openLive, onLive } from './app-state.js';
import { openDialog, closeDialog, signUpDialog } from './dialogs.js';

function main() {
  return document.getElementById('app');
}

// ---------- Profile ----------

export async function profileScreen() {
  const me = await loadMe().catch(() => state.me);
  const title = el('h1', { text: 'Profile' });
  const container = el('div', {});
  main().replaceChildren(title, container);
  if (!me) {
    container.append(el('p', { text: 'Sign in to see your record.' }));
    return;
  }

  const record = el('section', { class: 'panel', role: 'region', 'aria-label': 'Player record' },
    el('h2', { text: 'Player record' }),
    el('p', { text: `Level ${me.level}` }),
    el('p', { text: `Wins ${me.wins}` }),
    el('p', { text: `Losses ${me.losses}` }),
    el('p', { text: `Win rate ${Number(me.winRate).toFixed(1)}%` }),
    el('p', { text: `Streak ${me.winStreak}` }),
    el('p', { text: `Highest pot ${fmt(me.highestPot)}` })
  );
  container.append(record, el('h2', { text: 'Ledger' }));

  const ledgerTable = el('table', { class: 'data', 'aria-label': 'Ledger' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Kind' }), el('th', { text: 'Amount' }), el('th', { text: 'Balance after' }))),
    el('tbody', {})
  );
  container.append(ledgerTable);

  const coins = await api('/api/wallet/ledger?currency=coins').catch(() => null);
  const cash = await api('/api/wallet/ledger?currency=cash').catch(() => null);
  const rows = [];
  const all = [...(coins?.lines ?? []), ...(cash?.lines ?? [])];
  const sorted = all.sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)) || (b.id > a.id ? 1 : -1)).slice(0, 50);
  let runningCoins = coins?.balance ?? 0;
  let runningCash = cash?.balance ?? 0;
  const byId = new Map(sorted.map((line) => [line.id, line]));
  for (const line of sorted) {
    const currency = line.currency === 'coins' ? 'Coins' : 'Cash';
    rows.push(el('tr', {},
      el('td', { text: new Date(line.createdAt).toISOString().slice(0, 10) }),
      el('td', { text: line.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }),
      el('td', { text: `${line.amount > 0 ? '+' : '-'}${fmt(Math.abs(line.amount))} ${currency}` }),
      el('td', { text: `${fmt(currency === 'Coins' ? runningCoins : runningCash)} ${currency}` })
    ));
    if (line.currency === 'coins') runningCoins -= line.amount;
    else runningCash -= line.amount;
  }
  ledgerTable.querySelector('tbody').replaceChildren(...rows.slice(0, 50));
  void byId;
}

// ---------- Settings ----------

export async function settingsScreen() {
  const me = await loadMe().catch(() => null);
  const title = el('h1', { text: 'Settings' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  const settings = state.settings;
  const toggles = [
    ['sound', 'Sound'],
    ['music', 'Music'],
    ['leftHanded', 'Left-handed mode'],
    ['reducedMotion', 'Reduced motion'],
  ];
  for (const [key, label] of toggles) {
    const input = el('input', { type: 'checkbox', id: `set-${key}`, ...(settings?.[key] ? { checked: true } : {}) });
    input.setAttribute('role', 'switch');
    container.append(el('div', { class: 'row-between' }, el('label', { for: `set-${key}`, text: label }), input));
    input.addEventListener('change', async () => {
      await api('/api/me/settings', { method: 'PATCH', body: { [key]: input.checked } }).catch(() => undefined);
      settings[key] = input.checked;
      if (key === 'reducedMotion') document.body.dataset.reduced = input.checked ? 'true' : 'false';
      if (key === 'leftHanded') window.dispatchEvent(new CustomEvent('settings:lefthanded', { detail: { leftHanded: input.checked } }));
    });
  }

  const aim = el('input', { type: 'range', min: '1', max: '10', step: '1', value: String(settings?.aimSensitivity ?? 5), id: 'set-aim' });
  aim.setAttribute('aria-label', 'Aim sensitivity');
  container.append(aim);
  aim.addEventListener('change', async () => {
    await api('/api/me/settings', { method: 'PATCH', body: { aimSensitivity: Number(aim.value) } }).catch(() => undefined);
  });

  const themeRadios = el('div', { role: 'radiogroup', 'aria-label': 'Theme' });
  for (const [value, label] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]) {
    const input = el('input', { type: 'radio', name: 'theme', value, id: `theme-${value}`, ...(settings?.theme === value ? { checked: true } : {}) });
    input.addEventListener('change', async () => {
      await api('/api/me/settings', { method: 'PATCH', body: { theme: value } }).catch(() => undefined);
      settings.theme = value;
      document.documentElement.dataset.theme = value === 'light' ? 'light' : value === 'dark' ? 'dark'
        : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    });
    themeRadios.append(el('div', {}, el('label', { for: `theme-${value}`, text: label }), input));
  }
  container.append(el('h2', { text: 'Theme' }), themeRadios);

  if (me) {
    container.append(el('h2', { text: 'Blocked users' }));
    const blockedList = el('ul', { class: 'roster-list', role: 'list', 'aria-label': 'Blocked users' });
    const friends = await api('/api/friends').catch(() => null);
    for (const blocked of friends?.blocked ?? []) {
      blockedList.append(el('li', {},
        el('span', { text: blocked.displayName }),
        el('button', { 'aria-label': `Unblock ${blocked.displayName}`, text: 'Unblock', onclick: async () => {
          await api(`/api/friends/${blocked.id}/block`, { method: 'DELETE' }).catch(() => undefined);
          blocked.closest('li')?.remove();
        } })
      ));
    }
    if ((friends?.blocked ?? []).length === 0) blockedList.append(el('li', { text: 'None' }));
    container.append(blockedList);

    const deleteBtn = el('button', { class: 'danger', text: 'Delete account', onclick: () => {
      const dialog = el('dialog', { 'aria-label': 'Delete account' });
      const password = el('input', { type: 'password', id: 'delete-password' });
      const passwordLabel = el('label', { for: 'delete-password', text: 'Password' });
      dialog.append(
        el('h2', { text: 'Delete account' }),
        el('div', { class: 'field' }, passwordLabel, password),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'danger', text: 'Delete my account', onclick: async () => {
            try {
              await api('/api/me', { method: 'DELETE', body: { password: password.value } });
              closeDialog(dialog);
              dialog.remove();
              navigate('/home');
            } catch (err) {
              dialog.append(el('p', { class: 'mode-note', text: err.message }));
            }
          } }),
          el('button', { text: 'Keep my account', onclick: () => { closeDialog(dialog); dialog.remove(); } })
        )
      );
      document.body.append(dialog);
      dialog.showModal();
      password.focus();
    } });
    container.append(el('h2', { text: 'Danger zone' }), deleteBtn);
  }
}

// ---------- Friends panel ----------

export async function openFriendsPanel() {
  let existing = document.getElementById('friends-panel');
  if (existing) {
    existing.hidden = false;
    existing.classList.remove('closing');
    return;
  }

  const me = state.me;
  if (!me) return;

  const panel = el('aside', { class: 'friends-panel', role: 'region', 'aria-label': 'Friends', id: 'friends-panel' });
  const notice = el('p', { class: 'status', role: 'status', 'aria-label': 'Friends notice', text: '' });
  const codeInput = el('input', { type: 'text', id: 'friend-code', maxlength: '8' });
  const sendBtn = el('button', { id: 'send-request', text: 'Send request', onclick: async () => {
    try {
      const res = await api('/api/friends/requests', { method: 'POST', body: { code: codeInput.value.trim() } });
      notice.textContent = copy.requestSent(pendingName ?? codeInput.value.trim());
      void res;
    } catch (err) {
      notice.textContent = err.code === 'unknown_code' ? copy.unknownCode
        : err.code === 'blocked' ? copy.blockedFriend
        : err.message;
    }
  } });
  let pendingName = null;

  const friendsList = el('ul', { class: 'friend-list', role: 'list', 'aria-label': 'Friends list' });
  const incoming = el('ul', { class: 'friend-list', 'aria-label': 'Incoming requests' });
  const inviteLink = el('input', { type: 'text', readonly: true, id: 'invite-link', 'aria-label': 'Invite link', value: '' });
  const copyBtn = el('button', { id: 'copy-link', text: 'Copy link', onclick: async () => {
    if (!inviteLink.value) return;
    try {
      await navigator.clipboard.writeText(inviteLink.value);
      notice.textContent = 'Link copied.';
    } catch {
      notice.textContent = inviteLink.value;
    }
  } });
  const createTableBtn = el('button', { id: 'create-private-table', text: 'Create private table', onclick: async () => {
    try {
      const res = await api('/api/private-tables', { method: 'POST' });
      inviteLink.value = res.inviteUrl;
      notice.textContent = copy.hostWaiting;
    } catch (err) {
      notice.textContent = err.message;
    }
  } });
  const closeBtn = el('button', { id: 'close-friends', text: 'Close friends', onclick: () => closePanel() });

  panel.append(
    el('h2', { text: 'Friends' }),
    notice,
    el('p', { class: 'mode-note', text: `Your code: ${me.friendCode}` }),
    el('div', { class: 'field' }, el('label', { for: 'friend-code', text: 'Friend code' }), codeInput, sendBtn),
    el('div', {}, createTableBtn, copyBtn),
    inviteLink,
    el('h3', { text: 'Friends' }),
    friendsList,
    el('h3', { text: 'Requests' }),
    incoming
  );
  document.body.append(panel);

  function closePanel() {
    const reduced = state.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      panel.hidden = true;
      panel.remove();
    } else {
      panel.classList.add('closing');
      const timer = setTimeout(() => { panel.hidden = true; panel.remove(); }, 320);
      panel.dataset.closeTimer = String(timer);
    }
    const opener = document.getElementById('open-friends-btn');
    opener?.focus();
  }

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
    }
  });

  async function refresh() {
    let data;
    try {
      data = await api('/api/friends');
    } catch {
      return;
    }
    friendsList.replaceChildren();
    for (const friend of data.friends) {
      friendsList.append(el('li', {},
        el('span', { text: `${friend.displayName} — ${friend.presence === 'in_match' ? 'In a match' : friend.presence === 'online' ? 'Online' : 'Offline'}` }),
        el('button', { 'aria-label': `Block ${friend.displayName}`, text: 'Block', onclick: async () => {
          await api(`/api/friends/${friend.id}/block`, { method: 'POST' }).catch(() => undefined);
          refresh();
        } })
      ));
    }
    if (data.friends.length === 0) friendsList.append(el('li', { text: 'No friends yet.' }));
    incoming.replaceChildren();
    for (const request of data.incoming) {
      incoming.append(el('li', {},
        el('span', { text: request.displayName }),
        el('button', { 'aria-label': `Accept ${request.displayName}`, text: 'Accept', onclick: async () => {
          try {
            await api(`/api/friends/requests/${request.requestId}/accept`, { method: 'POST' });
            notice.textContent = copy.friendAccepted(request.displayName);
            refresh();
          } catch (err) {
            notice.textContent = err.message;
          }
        } }),
        el('button', { 'aria-label': `Decline ${request.displayName}`, text: 'Decline', onclick: async () => {
          await api(`/api/friends/requests/${request.requestId}/decline`, { method: 'POST' }).catch(() => undefined);
          refresh();
        } })
      ));
    }
  }

  await refresh();
  await openLive(['friends']);
  onLive(() => {
    void refresh();
  });
  return panel;
}

// ---------- Verify ----------

export async function verifyScreen() {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const title = el('h1', { text: copy.verifiedHeading });
  const container = el('div', {});
  main().replaceChildren(title, container);
  try {
    await api('/api/auth/verify', { method: 'POST', body: { token } });
    container.append(el('p', { text: copy.verifiedHeading }));
  } catch (err) {
    container.append(el('p', { text: err.code === 'link_invalid' ? copy.linkInvalid : err.message }));
  }
  container.append(el('a', { href: '/home', text: 'Home' }));
}

// ---------- Invite ----------

export async function inviteScreen(token) {
  const title = el('h1', { text: 'Invite' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  try {
    const invite = await api(`/api/invites/${token}`);
    container.append(el('p', { text: `${invite.hostName} invited you to a table.` }));
    if (!state.me) {
      container.append(el('p', { class: 'mode-note', text: copy.inviteNote }));
      const signup = el('button', { class: 'primary', text: 'Create account', onclick: async () => {
        await signUpDialog({ onDone: async () => {
          const accepted = await api(`/api/invites/${token}/accept`, { method: 'POST' });
          navigate(accepted.tableUrl);
        } });
      } });
      container.append(signup);
      const signin = el('button', { text: 'Sign in', onclick: async () => {
        await signUpDialog({ mode: 'signin', onDone: async () => {
          const accepted = await api(`/api/invites/${token}/accept`, { method: 'POST' });
          navigate(accepted.tableUrl);
        } });
      } });
      container.append(signin);
    } else {
      const join = el('button', { class: 'primary', text: 'Join table', onclick: async () => {
        try {
          const accepted = await api(`/api/invites/${token}/accept`, { method: 'POST' });
          navigate(accepted.tableUrl);
        } catch (err) {
          container.append(el('p', { text: err.message }));
        }
      } });
      container.append(join);
    }
  } catch (err) {
    container.append(el('p', { text: err.code === 'invite_expired' ? copy.inviteExpired : err.message }));
  }
}

// ---------- Add friend by link ----------

export async function addFriendScreen(code) {
  const title = el('h1', { text: 'Add friend' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  if (!state.me) {
    container.append(el('p', { class: 'mode-note', text: copy.inviteNote }));
    const signup = el('button', { class: 'primary', text: 'Create account', onclick: async () => {
      await signUpDialog({ onDone: () => navigate(`/friends/add/${code}`) });
    } });
    container.append(signup);
    return;
  }

  try {
    const res = await api('/api/friends/requests', { method: 'POST', body: { code } });
    container.append(el('p', { text: copy.requestSent(code) }));
    void res;
  } catch (err) {
    container.append(el('p', { text: err.code === 'unknown_code' ? copy.unknownCode : err.code === 'blocked' ? copy.blockedFriend : err.message }));
  }
  container.append(el('a', { href: '/home', text: 'Home' }));
}
