// Shop, tournaments, clubs, leaderboards, profile, settings and friends panel.

import { el, api, navigate, fmt, copy, TIERS, PRESET_MESSAGES } from './ui.js';
import { state, loadMe, openLive, onLive } from './app-state.js';
import { openDialog, closeDialog } from './dialogs.js';

function main() {
  return document.getElementById('app');
}

// ---------- Shop ----------

export async function shopScreen() {
  await loadMe().catch(() => undefined);
  const me = state.me;
  const title = el('h1', { text: 'Shop' });
  const notice = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Shop notice', id: 'shop-notice', text: '' });
  const container = el('div', {});
  main().replaceChildren(title, notice, container);

  let data;
  try {
    data = await api('/api/shop');
  } catch (err) {
    container.append(el('p', { class: 'mode-note', text: err.message }));
    return;
  }

  const tabs = [['cues', 'Cues'], ['cash-cues', 'Cash cues'], ['cloths', 'Cloths'], ['packs', 'Cash packs']];
  const tablist = el('div', { role: 'tablist', 'aria-label': 'Shop sections', class: 'shop-tabs' });
  const grid = el('div', { class: 'shop-grid' });
  let activeTab = 'cues';

  const tabButtons = tabs.map(([id, label], index) => {
    const button = el('button', { role: 'tab', id: `tab-${id}`, 'aria-selected': index === 0 ? 'true' : 'false', tabindex: index === 0 ? '0' : '-1', text: label, onclick: () => activate(id) });
    return { id, button };
  });
  for (const { button } of tabButtons) tablist.append(button);
  container.append(tablist, grid);

  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const dir = event.key === 'ArrowRight' ? 1 : -1;
    const index = tabButtons.findIndex((entry) => entry.id === activeTab);
    const next = (index + dir + tabButtons.length) % tabButtons.length;
    activate(tabButtons[next].id);
    tabButtons[next].button.focus();
  });

  function itemsFor(tab) {
    if (tab === 'cues') return data.items.filter((item) => item.kind === 'cue' && item.currency === 'coins');
    if (tab === 'cash-cues') return data.items.filter((item) => item.kind === 'cue' && item.currency === 'cash');
    if (tab === 'cloths') return data.items.filter((item) => item.kind === 'cloth');
    return [];
  }

  function activate(tab) {
    activeTab = tab;
    tabButtons.forEach((entry) => {
      entry.button.setAttribute('aria-selected', entry.id === tab ? 'true' : 'false');
      entry.button.tabIndex = entry.id === tab ? 0 : -1;
    });
    notice.textContent = '';
    grid.replaceChildren();
    if (tab === 'packs') {
      renderPacks();
      return;
    }
    for (const item of itemsFor(tab)) {
      const button = el('button', { class: 'shop-item', 'aria-label': item.name, onclick: (event) => openItem(item, event.currentTarget) },
        el('div', { class: 'tier-name', text: item.name }),
        el('div', { class: 'price', text: item.currency === 'coins' ? `${fmt(item.price)} Coins` : `${item.price} Cash` }),
        el('div', { class: 'mode-note', text: item.owned ? (item.equipped ? copy.equippedWord : copy.owned) : `Aim +${item.aim}% Power +${item.power}% Spin +${item.spin}% Time +${item.time} s` })
      );
      grid.append(button);
    }
  }

  async function openItem(item, opener) {
    const dialog = el('dialog', { 'aria-label': item.name });
    const stats = el('div', { class: 'stat-bars' });
    for (const [label, value] of [['Aim', item.aim], ['Power', item.power], ['Spin', item.spin], ['Time', item.time]]) {
      stats.append(el('div', { class: 'stat-row' },
        el('span', { text: label }),
        el('div', { class: 'progress-track', role: 'progressbar', 'aria-label': `${label} bonus`, 'aria-valuemin': '0', 'aria-valuemax': '25', 'aria-valuenow': String(value) },
          el('div', { class: 'progress-fill', style: { width: `${Math.min(100, (value / 25) * 100)}%` } })),
        el('span', { class: 'stat-value', text: `+${value}${label === 'Time' ? ' s' : '%'}` })
      ));
    }
    const compare = item.kind === 'cue'
      ? el('section', { role: 'region', 'aria-label': 'Compare' },
          el('h3', { text: 'Compare' }),
          stats,
          el('p', { class: 'mode-note', text: `Equipped: ${equippedName(state.me?.equippedCueId)}` }))
      : null;

    const buyLabel = `Buy for ${fmt(item.price)} ${item.currency === 'coins' ? 'Coins' : 'Cash'}`;
    const buyBtn = el('button', { class: 'primary', text: buyLabel, onclick: async () => {
      buyBtn.disabled = true;
      try {
        await api(`/api/shop/items/${item.id}/buy`, { method: 'POST' });
        notice.textContent = copy.bought(item.name);
        buyBtn.replaceWith(equipBtn);
        equipBtn.focus();
        await loadMe().catch(() => undefined);
      } catch (err) {
        notice.textContent = err.code === 'insufficient_funds' ? shortFundsFor(item) : err.code === 'level_locked' ? copy.levelLockedItem(item.minLevel) : err.message;
        buyBtn.disabled = false;
      }
    } });
    const equipBtn = el('button', { class: 'primary', text: 'Equip', onclick: async () => {
      equipBtn.disabled = true;
      try {
        await api(`/api/shop/items/${item.id}/equip`, { method: 'POST' });
        notice.textContent = copy.equipped(item.name);
        await loadMe().catch(() => undefined);
      } catch (err) {
        notice.textContent = err.message;
        equipBtn.disabled = false;
      }
    } });

    if (!item.owned) {
      const levelShort = state.me && state.me.level < item.minLevel;
      const coinsShort = item.currency === 'coins' && state.me && state.me.coins < item.price;
      const cashShort = item.currency === 'cash' && state.me && state.me.cash < item.price;
      if (levelShort) {
        notice.textContent = copy.levelLockedItem(item.minLevel);
        buyBtn.disabled = true;
      } else if (coinsShort || cashShort) {
        notice.textContent = shortFundsFor(item);
        buyBtn.disabled = true;
      }
    }

    dialog.append(
      el('h2', { text: item.name }),
      el('p', { class: 'price', text: item.currency === 'coins' ? `${fmt(item.price)} Coins` : `${item.price} Cash` }),
      compare ?? el('span', { hidden: true }),
      el('div', { class: 'dialog-actions' },
        item.owned ? (item.equipped ? equipBtn : equipBtn) : buyBtn,
        el('button', { text: 'Close', onclick: () => { closeDialog(dialog); dialog.remove(); notice.textContent = ''; } })
      )
    );
    if (item.owned) {
      if (item.equipped) equipBtn.disabled = true;
      dialog.querySelector('.dialog-actions').prepend(equipBtn);
      buyBtn.remove();
    }
    document.body.append(dialog);
    openDialog(dialog, opener);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); dialog.remove(); notice.textContent = ''; });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog);
        dialog.remove();
        notice.textContent = '';
      }
    });
  }

  function shortFundsFor(item) {
    const currency = item.currency === 'coins' ? 'Coins' : 'Cash';
    const balance = item.currency === 'coins' ? state.me?.coins ?? 0 : state.me?.cash ?? 0;
    return copy.shortFunds(Math.max(0, item.price - balance), currency);
  }

  function renderPacks() {
    if (!me) return;
    if (me.minor) {
      notice.textContent = copy.under18;
      return;
    }
    if (!me.emailVerified) {
      notice.textContent = copy.unverified;
      grid.append(el('button', { id: 'resend-verification', text: 'Resend verification', onclick: async () => {
        try {
          const res = await api('/api/auth/resend-verification', { method: 'POST' });
          notice.textContent = copy.resent(me.email);
          void res;
        } catch (err) {
          notice.textContent = err.code === 'mail_unavailable' ? copy.mailDownResend : err.message;
        }
      } }));
      return;
    }
    for (const pack of data.packs) {
      const button = el('button', { class: 'shop-item', 'aria-label': `Buy ${pack.name}`, onclick: (event) => openPack(pack, event.currentTarget) },
        el('div', { class: 'tier-name', text: pack.name }),
        el('div', { class: 'price', text: `${pack.cash} Cash` }),
        el('div', { class: 'mode-note', text: `$${pack.priceUsd}` })
      );
      grid.append(button);
    }
  }

  async function openPack(pack, opener) {
    const dialog = el('dialog', { 'aria-label': 'Buy Cash' });
    const payBtn = el('button', { class: 'primary', text: `Pay $${pack.priceUsd}`, onclick: async () => {
      payBtn.disabled = true;
      cancelBtn.disabled = true;
      notice.textContent = copy.confirming;
      try {
        const key = `pack-${pack.id}-${Date.now()}`;
        const res = await api(`/api/shop/cash-packs/${pack.id}/purchase`, { method: 'POST', headers: { 'Idempotency-Key': key } });
        notice.textContent = res.receipt === 'sent' ? copy.packSent(res.cash, me.email) : copy.packDelayed(res.cash);
        closeDialog(dialog);
        dialog.remove();
        await loadMe().catch(() => undefined);
        opener?.focus();
      } catch (err) {
        notice.textContent = err.code === 'payments_unavailable' ? copy.paymentsDown : err.message;
        payBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    } });
    const cancelBtn = el('button', { text: 'Cancel', onclick: () => { closeDialog(dialog); dialog.remove(); opener?.focus(); } });
    dialog.append(
      el('h2', { text: 'Buy Cash' }),
      el('p', { text: `${pack.name}: ${pack.cash} Cash for $${pack.priceUsd}` }),
      el('div', { class: 'dialog-actions' }, payBtn, cancelBtn)
    );
    document.body.append(dialog);
    openDialog(dialog, opener);
    dialog.addEventListener('cancel', (event) => {
      if (notice.textContent === copy.confirming) { event.preventDefault(); return; }
      event.preventDefault();
      closeDialog(dialog);
      dialog.remove();
      opener?.focus();
    });
  }

  activate('cues');
}

function equippedName(id) {
  const names = {
    'cue-starter': 'Starter Cue',
    'cue-ash-break': 'Ash Break',
    'cue-copper-ferrule': 'Copper Ferrule',
    'cue-night-maple': 'Night Maple',
    'cue-velvet-taper': 'Velvet Taper',
    'cue-long-rail-master': 'Long Rail Master',
    'cue-brass-inlay': 'Brass Inlay',
    'cue-lamp-black': 'Lamp Black',
  };
  return names[id] ?? 'Starter Cue';
}

// ---------- Tournaments ----------

export async function tournamentsScreen() {
  await loadMe().catch(() => undefined);
  const title = el('h1', { text: 'Tournaments' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  let data;
  try {
    data = await api('/api/tournaments');
  } catch (err) {
    container.append(el('p', { text: err.message }));
    return;
  }

  for (const tournament of data.tournaments) {
    const region = el('section', { class: 'panel', 'aria-label': `${TIERS[tournament.tier - 1].name} bracket` });
    const entrants = el('p', { class: 'status', role: 'status', 'aria-label': 'Entrants', text: copy.entrants(tournament.entrantCount, 8) });
    const registerBtn = el('button', { class: 'primary', text: `Register for ${tournament.tierName}`, onclick: async () => {
      registerBtn.disabled = true;
      try {
        const fresh = await api(`/api/tournaments/${tournament.id}/register`, { method: 'POST' });
        entrants.textContent = copy.entrants(fresh.entrantCount, 8);
        container.append(el('p', { text: copy.registered(fresh.entry) }));
        await loadMe().catch(() => undefined);
        if (fresh.entrantCount >= 8) navigate(`/tournaments/${tournament.id}`);
      } catch (err) {
        container.append(el('p', { text: err.code === 'tournament_full' ? copy.bracketFull : err.message }));
        registerBtn.disabled = false;
      }
    } });
    region.append(
      el('h2', { text: tournament.tierName }),
      el('p', { class: 'mode-note', text: `Entry ${fmt(tournament.entry)} Coins` }),
      entrants,
      registerBtn,
      el('a', { href: `/tournaments/${tournament.id}`, text: 'View bracket' })
    );
    container.append(region);
  }
}

export async function bracketScreen(tournamentId) {
  const title = el('h1', { text: 'Bracket' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  let body;
  try {
    body = await api(`/api/tournaments/${tournamentId}`);
  } catch (err) {
    container.append(el('p', { text: err.message }));
    return;
  }

  const entrants = el('p', { class: 'status', role: 'status', 'aria-label': 'Entrants', text: copy.entrants(body.entrantCount, 8) });
  const readyStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Ready check', text: body.readySecondsLeft !== null ? copy.readyCheck(body.readySecondsLeft) : '' });
  const announce = el('div', { class: 'log', role: 'log', 'aria-label': 'Tournament announcements', 'aria-live': 'polite' });

  const region = el('section', { class: 'bracket-region', role: 'region', 'aria-label': 'Bracket' });
  const list = el('ul', { class: 'bracket-slots', role: 'list', 'aria-label': 'Bracket slots' });
  for (let slot = 1; slot <= 8; slot++) {
    const entrant = body.entrants.find((entry) => entry.slot === slot);
    const label = entrant ? `Slot ${slot}: ${entrant.displayName}` : `Slot ${slot}: Open`;
    const item = el('li', { tabindex: '0', text: label });
    list.append(item);
  }
  region.append(list);

  const prizeRows = [
    ['First', body.prizes.first],
    ['Second', body.prizes.second],
    ['Semi-final', body.prizes.semiFinal],
    ['House', body.prizes.house],
  ];
  const prizeTable = el('table', { class: 'data', 'aria-label': 'Prize split' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Place' }), el('th', { text: 'Coins' }))),
    el('tbody', {}, ...prizeRows.map(([place, coins]) => el('tr', {}, el('td', { text: place }), el('td', { text: fmt(coins) }))))
  );

  const readyBtn = el('button', { class: 'primary', text: 'Ready', onclick: async () => {
    readyBtn.disabled = true;
    try {
      const fresh = await api(`/api/tournaments/${tournamentId}/ready`, { method: 'POST' });
      readyStatus.textContent = copy.youAreReady;
      if (fresh.status === 'round_of_8') {
        announce.append(el('p', { text: copy.allReady }));
      }
    } catch (err) {
      readyStatus.textContent = err.message;
      readyBtn.disabled = false;
    }
  } });

  container.append(
    el('h2', { text: `${body.tierName} bracket` }),
    entrants,
    region,
    prizeTable,
    readyStatus,
    readyBtn,
    announce
  );

  if (body.status === 'ready_check') {
    announce.append(el('p', { text: copy.bracketDrawn }));
  }
  if (body.status === 'refunded') {
    announce.append(el('p', { text: copy.windowShort(body.entry) }));
  }

  await openLive([`tournament:${tournamentId}`]);
  onLive(() => {
    void (async () => {
      try {
        const fresh = await api(`/api/tournaments/${tournamentId}`);
        entrants.textContent = copy.entrants(fresh.entrantCount, 8);
        list.replaceChildren();
        for (let slot = 1; slot <= 8; slot++) {
          const entrant = fresh.entrants.find((entry) => entry.slot === slot);
          list.append(el('li', { tabindex: '0', text: entrant ? `Slot ${slot}: ${entrant.displayName}` : `Slot ${slot}: Open` }));
        }
        if (fresh.readySecondsLeft !== null) readyStatus.textContent = copy.readyCheck(fresh.readySecondsLeft);
      } catch { /* next tick retries */ }
    })();
  });
}

// ---------- Clubs ----------

export async function clubsScreen() {
  await loadMe().catch(() => undefined);
  const title = el('h1', { text: 'Clubs' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  let data;
  try {
    data = await api('/api/clubs');
  } catch (err) {
    container.append(el('p', { text: err.message }));
    return;
  }

  const notice = el('p', { class: 'status', role: 'status', 'aria-label': 'Club notice', text: '' });
  container.append(notice);

  const nameInput = el('input', { type: 'text', id: 'club-name', maxlength: '24' });
  const openRadio = el('input', { type: 'radio', name: 'join-policy', value: 'open', id: 'policy-open' });
  const requestRadio = el('input', { type: 'radio', name: 'join-policy', value: 'request', id: 'policy-request' });
  const createForm = el('section', { class: 'panel', 'aria-label': 'Create club' },
    el('h2', { text: 'Create a club' }),
    el('div', { class: 'field' }, el('label', { for: 'club-name', text: 'Club name' }), nameInput),
    el('div', { role: 'radiogroup', 'aria-label': 'Join policy' },
      el('div', {}, el('label', { for: 'policy-open', text: 'Open' }), openRadio),
      el('div', {}, el('label', { for: 'policy-request', text: 'Request to join' }), requestRadio)
    ),
    el('button', { class: 'primary', text: 'Create club', onclick: async () => {
      try {
        const policy = requestRadio.checked ? 'request' : 'open';
        const club = await api('/api/clubs', { method: 'POST', body: { name: nameInput.value.trim(), joinPolicy: policy } });
        navigate(`/clubs/${club.id}`);
      } catch (err) {
        notice.textContent = err.code === 'level_locked' ? copy.clubLevel(5)
          : err.code === 'insufficient_coins' ? copy.clubCoins(5000)
          : err.message;
      }
    } })
  );
  container.append(createForm);

  const list = el('div', { class: 'card-grid' });
  for (const club of data.clubs) {
    const join = el('button', { class: 'mode-card', 'aria-label': `Join ${club.name}`, onclick: async () => {
      try {
        const res = await api(`/api/clubs/${club.id}/join`, { method: 'POST' });
        notice.textContent = res.status === 'member' ? copy.joinedClub(club.name) : copy.requestedClub(club.name);
        if (res.status === 'member') navigate(`/clubs/${club.id}`);
      } catch (err) {
        notice.textContent = err.code === 'club_full' ? copy.clubFull : err.message;
      }
    } },
      el('div', { class: 'tier-name', text: club.name }),
      el('div', { class: 'mode-note', text: `${club.memberCount} / 50 members` }),
      el('div', { class: 'mode-note', text: `Weekly score ${club.weeklyScore}` }),
      el('span', { class: 'mode-note', text: club.joinPolicy === 'open' ? 'Open' : 'Request to join' })
    );
    const view = el('a', { href: `/clubs/${club.id}`, text: 'View' });
    list.append(el('div', { class: 'shop-item' }, join, view));
  }
  container.append(el('h2', { text: 'Clubs' }), list);
}

export async function clubScreen(clubId) {
  await loadMe().catch(() => undefined);
  const title = el('h1', { text: 'Club' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  let body;
  try {
    body = await api(`/api/clubs/${clubId}`);
  } catch (err) {
    container.append(el('p', { text: err.message }));
    return;
  }

  const notice = el('p', { class: 'status', role: 'status', 'aria-label': 'Club notice', text: '' });
  const weekly = el('p', { class: 'status', role: 'status', 'aria-label': 'Weekly score', text: `Weekly score ${body.weeklyScore}` });
  const members = el('p', { class: 'status', role: 'status', 'aria-label': 'Members', text: `${body.memberCount} / 50` });
  const roster = el('ul', { class: 'roster-list', role: 'list', 'aria-label': 'Roster' });
  const messages = el('div', { class: 'log', role: 'log', 'aria-label': 'Club messages', 'aria-live': 'polite' });
  const presetRow = el('div', { class: 'preset-row', role: 'group', 'aria-label': 'Preset messages' });

  for (const member of body.members) {
    const item = el('li', {},
      el('span', { text: `${member.displayName} — ${member.role}` }),
      el('span', { text: `${member.weeklyWins} wins` })
    );
    if (body.ownRole === 'owner' && member.playerId !== state.me?.id) {
      const roleBtn = el('button', { 'aria-label': `Change role for ${member.displayName}`, text: 'Change role', onclick: (event) => openRoleMenu(member, event.currentTarget) });
      item.append(roleBtn);
    }
    roster.append(item);
  }

  for (const message of body.messages) {
    messages.append(el('p', { text: `${message.displayName}: ${message.preset}` }));
  }

  for (const preset of PRESET_MESSAGES) {
    presetRow.append(el('button', { text: preset, onclick: async () => {
      try {
        await api(`/api/clubs/${clubId}/messages`, { method: 'POST', body: { preset } });
        messages.append(el('p', { text: `${state.me?.displayName}: ${preset}` }));
      } catch (err) {
        notice.textContent = err.message;
      }
    } }));
  }

  const requests = el('ul', { class: 'roster-list', 'aria-label': 'Join requests' });
  for (const request of body.requests) {
    requests.append(el('li', {},
      el('span', { text: request.displayName }),
      el('button', { 'aria-label': `Approve ${request.displayName}`, text: 'Approve', onclick: async () => {
        try {
          await api(`/api/clubs/${clubId}/requests/${request.playerId}`, { method: 'POST', body: { decision: 'approve' } });
          notice.textContent = copy.joinedClub(body.name);
          navigate(`/clubs/${clubId}`);
        } catch (err) {
          notice.textContent = err.code === 'club_full' ? copy.clubFull : err.message;
        }
      } }),
      el('button', { 'aria-label': `Reject ${request.displayName}`, text: 'Reject', onclick: async () => {
        await api(`/api/clubs/${clubId}/requests/${request.playerId}`, { method: 'POST', body: { decision: 'reject' } }).catch(() => undefined);
        request;
        navigate(`/clubs/${clubId}`);
      } })
    ));
  }

  container.append(
    el('h2', { text: body.name }),
    notice,
    weekly,
    members,
    el('h3', { text: 'Roster' }),
    roster,
    body.requests.length ? el('h3', { text: 'Join requests' }) : el('span', { hidden: true }),
    requests,
    el('h3', { text: 'Messages' }),
    messages,
    presetRow,
    el('button', { text: 'Leave club', onclick: async () => {
      try {
        await api(`/api/clubs/${clubId}/leave`, { method: 'POST' });
        notice.textContent = copy.leftClub(body.name);
        navigate('/clubs');
      } catch (err) {
        notice.textContent = err.code === 'owner_must_transfer' ? copy.ownerLeaving : err.message;
      }
    } })
  );

  function openRoleMenu(member, opener) {
    const menu = el('div', { role: 'menu', 'aria-label': `Change role for ${member.displayName}`, class: 'panel' });
    const items = [['owner', 'Make owner'], ['officer', 'Make officer'], ['member', 'Make member']];
    let focusIndex = 0;
    const buttons = items.map(([role, label], index) => el('button', { role: 'menuitem', text: label, tabindex: index === 0 ? '0' : '-1', onclick: async () => {
      try {
        await api(`/api/clubs/${clubId}/members/${member.playerId}`, { method: 'PATCH', body: { role } });
        notice.textContent = copy.roleChanged(member.displayName, role);
        menu.remove();
        opener?.focus();
        navigate(`/clubs/${clubId}`);
      } catch (err) {
        notice.textContent = err.message;
      }
    } }));
    for (const button of buttons) menu.append(button);
    document.body.append(menu);
    buttons[0].focus();
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusIndex = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, focusIndex + 1) : Math.max(0, focusIndex - 1);
        buttons[focusIndex].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        menu.remove();
        opener?.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target) && event.target !== opener) menu.remove();
    }, { once: true });
  }

  await openLive([`club:${clubId}`]);
  onLive(() => {
    void (async () => {
      try {
        const fresh = await api(`/api/clubs/${clubId}`);
        weekly.textContent = `Weekly score ${fresh.weeklyScore}`;
        members.textContent = `${fresh.memberCount} / 50`;
        for (const message of fresh.messages.slice(-1)) {
          if (message.playerId !== state.me?.id) {
            messages.append(el('p', { text: `${message.displayName}: ${message.preset}` }));
          }
        }
      } catch { /* next tick retries */ }
    })();
  });
}

// ---------- Leaderboards ----------

export async function leaderboardsScreen() {
  await loadMe().catch(() => undefined);
  const title = el('h1', { text: 'Leaderboards' });
  const container = el('div', { class: 'leaderboard-wrap' });
  main().replaceChildren(title, container);

  let scope = 'global';
  const tablist = el('div', { role: 'tablist', 'aria-label': 'Scope', class: 'shop-tabs' });
  const scopes = [['global', 'Global'], ['friends', 'Friends'], ['club', 'Club']];
  const tabButtons = scopes.map(([id, label]) => {
    const button = el('button', { role: 'tab', 'aria-selected': id === scope ? 'true' : 'false', text: label, onclick: () => { scope = id; load(); } });
    return { id, button };
  });
  for (const { button } of tabButtons) tabButtons.forEach((entry) => entry.button.setAttribute('aria-selected', entry.id === scope ? 'true' : 'false'));
  for (const { button } of tabButtons) tablist.append(button);

  const table = el('table', { class: 'data', 'aria-label': 'Weekly wins' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Rank' }), el('th', { text: 'Name' }), el('th', { text: 'Wins' }))),
    el('tbody', {})
  );
  const own = el('div', { class: 'your-rank', role: 'region', 'aria-label': 'Your rank', text: copy.unranked });

  container.append(tablist, table, own);

  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = scopes.findIndex(([id]) => id === scope);
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + scopes.length) % scopes.length;
    scope = scopes[next][0];
    load();
    tabButtons[next].button.focus();
  });

  async function load() {
    for (const entry of tabButtons) entry.button.setAttribute('aria-selected', entry.id === scope ? 'true' : 'false');
    let body;
    try {
      body = await api(`/api/leaderboards?scope=${scope}`);
    } catch (err) {
      table.querySelector('tbody').replaceChildren(el('tr', {}, el('td', { text: err.message })));
      return;
    }
    const rows = body.rows.map((row) => el('tr', {},
      el('td', { text: `#${row.rank}` }),
      el('td', { text: row.displayName }),
      el('td', { text: String(row.wins) })
    ));
    if (rows.length === 0) {
      const emptyText = scope === 'friends' ? copy.friendsBoardEmpty : scope === 'club' ? copy.clubBoardEmpty : 'No wins this week yet.';
      rows.push(el('tr', {}, el('td', { text: emptyText })));
    }
    table.querySelector('tbody').replaceChildren(...rows);
    if (body.own.rank === null) {
      own.textContent = body.own.wins > 0 ? `#${body.own.rank ?? ''} ${state.me?.displayName ?? ''} ${body.own.wins} wins` : copy.unranked;
      if (body.own.rank === null && body.own.wins > 0) own.textContent = `${state.me?.displayName ?? ''} ${body.own.wins} wins`;
      else if (body.own.rank === null) own.textContent = copy.unranked;
    } else {
      own.textContent = `#${body.own.rank} ${state.me?.displayName ?? ''} ${body.own.wins} wins`;
    }
  }
  await load();
}

export { openDialog, closeDialog };
