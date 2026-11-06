// The context panels: Raid log, Rewards, Clan, League and Profile. Only one is open at a time.
import { el, notice, alertMessage, commaFormat, formatClock, formatDateTime, formatAmounts, idempotencyKey } from '../ui.ts';
import { api, ApiRequestError, type ClanInfo, type Invitation, type Message, type RaidListRow, type RewardsInfo, type UnitRequest, type Village } from '../api.ts';
import type { Shell } from '../shell.ts';
import { state, setPollJob } from '../state.ts';
import { unitLabel } from '../shell.ts';

let currentPanel: string | null = null;
let shell: Shell | null = null;
let raidLogTab: 'attacks' | 'defences' = 'attacks';
let clanTab = 'members';

export function closePanel(): void {
  currentPanel = null;
  if (shell !== null) {
    shell.panelHost.className = 'context-panel hidden';
    shell.panelHost.replaceChildren();
  }
  setPollJob('panel', null);
  state.clanChatVisible = false;
  shell?.setUnreadClan(state.unreadClan);
}

export async function openPanel(name: string, host: Shell): Promise<void> {
  shell = host;
  if (name === 'build' || name === 'train') return;
  currentPanel = name;
  state.clanChatVisible = name === 'clan' && clanTab === 'chat';
  if (name === 'clan' && clanTab === 'chat') {
    state.unreadClan = 0;
    shell.setUnreadClan(0);
  }
  switch (name) {
    case 'raidlog': return void renderRaidLog();
    case 'rewards': return void renderRewards();
    case 'clan': return void renderClan();
    case 'league': return void renderLeague();
    case 'profile': return void renderProfile();
    default: closePanel();
  }
}

export function villageUpdated(_village: Village): void {
  // panels that show village data refresh through their own poll jobs
}

function panelOpen(name: string): boolean {
  return currentPanel === name;
}

function errorCopy(err: unknown): void {
  if (err instanceof ApiRequestError) {
    alertMessage(err.api.message);
    return;
  }
  alertMessage('Lost contact with the server. Check your connection and try again.');
}

// --- Raid log ---

async function renderRaidLog(): Promise<void> {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Raid log');
  host.replaceChildren(el('h2', { text: 'Raid log' }));

  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const list = el('div', { class: 'rows' });
  const render = async (role: 'attack' | 'defence'): Promise<void> => {
    notice('Loading raids…');
    try {
      const result = await api<{ raids: RaidListRow[] }>('GET', `/api/raids?role=${role}`);
      const zone = state.me?.timeZone ?? 'UTC';
      list.replaceChildren();
      if (result.raids.length === 0) {
        list.append(el('p', { text: 'No raids yet.' }));
      }
      for (const raid of result.raids) {
        const dateText = raid.resolvedAt ?? raid.lockedAt;
        let rowText: string;
        if (raid.state === 'resolved') {
          const transferred = raid.transferred ? formatAmounts(raid.transferred) : 'nothing';
          rowText = `${raid.stars} stars · ${raid.destruction}% · ${transferred} · ${formatDateTime(Date.parse(dateText), zone)}`;
        } else if (raid.state === 'abandoned') {
          rowText = `Abandoned · ${formatDateTime(Date.parse(dateText), zone)}`;
        } else {
          rowText = `Under way · ${formatDateTime(Date.parse(dateText), zone)}`;
        }
        const label = role === 'attack' ? `Replay raid on ${raid.opponent.displayName}` : `Replay raid by ${raid.opponent.displayName}`;
        const replayButton = el('button', { text: label, onclick: () => { window.location.href = `/raids/${raid.id}/replay`; } });
        list.append(el('div', { class: 'row' }, el('span', { text: rowText }), raid.state === 'resolved' ? replayButton : el('span')));
      }
    } catch (err) {
      errorCopy(err);
    }
  };

  for (const [key, label] of [['attacks', 'Attacks'], ['defences', 'Defences']] as const) {
    const tab = el('button', { role: 'tab', text: label, 'aria-selected': String(raidLogTab === key), onclick: async () => {
      raidLogTab = key;
      for (const button of tabs.querySelectorAll('button')) button.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-selected', 'true');
      await render(key === 'attacks' ? 'attack' : 'defence');
    }});
    tabs.append(tab);
  }
  host.append(tabs, list);
  await render(raidLogTab === 'attacks' ? 'attack' : 'defence');

  setPollJob('raidlog', async () => {
    if (!panelOpen('raidlog')) return;
    await render(raidLogTab === 'attacks' ? 'attack' : 'defence');
  });
}

// --- Rewards ---

async function renderRewards(): Promise<void> {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Rewards');
  host.replaceChildren(el('h2', { text: 'Rewards' }));
  const body = el('div', { class: 'rows' });
  host.append(body);

  const update = async (): Promise<void> => {
    const info = await api<RewardsInfo>('GET', '/api/me/rewards');
    const zone = info.timeZone;
    body.replaceChildren();
    const chestText = info.daily.claimed
      ? `Next chest ${formatDateTime(Date.parse(info.daily.nextClaimAt!), zone)}`
      : 'Chest ready to open';
    body.append(el('p', { text: chestText }));
    body.append(el('p', { text: `Streak day ${info.daily.streak} of 7` }));
    body.append(el('p', { text: `Next chest holds ${formatAmounts(info.daily.chest)}` }));
    const bonusText = info.weekly.claimed
      ? `Next league bonus ${formatDateTime(Date.parse(info.weekly.nextClaimAt!), zone)}`
      : 'League bonus ready to claim';
    body.append(el('p', { text: bonusText }));
    body.append(el('p', { text: `Star bonuses today ${info.starBonus.used}/${info.starBonus.cap}` }));

    const chestButton = el('button', { text: 'Open daily chest', disabled: info.daily.claimed ? 'true' : null, onclick: async () => {
      notice('Opening…');
      try {
        const result = await api<{ credited: { brine: number; peat: number; copper: number }; streak: number }>('POST', '/api/me/rewards/daily', {});
        notice(`Daily chest opened (day ${result.streak} of 7): ${formatAmounts(result.credited)}.`);
        await update();
      } catch (err) {
        if (err instanceof ApiRequestError && err.api.code === 'already_claimed' && err.api.nextClaimAt) {
          alertMessage(`Next chest at ${formatDateTime(Date.parse(err.api.nextClaimAt), zone)}.`);
        } else {
          errorCopy(err);
        }
      }
    }});
    const bonusButton = el('button', { text: 'Claim league bonus', disabled: info.weekly.claimed ? 'true' : null, onclick: async () => {
      notice('Claiming…');
      try {
        const result = await api<{ credited: { brine: number; peat: number; copper: number }; league: string }>('POST', '/api/me/rewards/weekly', {});
        notice(`${result.league} league bonus claimed: ${formatAmounts(result.credited)}.`);
        await update();
      } catch (err) {
        if (err instanceof ApiRequestError && err.api.code === 'already_claimed' && err.api.nextClaimAt) {
          alertMessage(`Next league bonus at ${formatDateTime(Date.parse(err.api.nextClaimAt), zone)}.`);
        } else {
          errorCopy(err);
        }
      }
    }});
    body.append(el('div', { class: 'actions' }, chestButton, bonusButton));
  };
  await update();

  setPollJob('rewards', async () => {
    if (!panelOpen('rewards')) return;
    await update();
  });
}

// --- Clan ---

async function renderClan(): Promise<void> {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Clan');
  host.replaceChildren();

  const update = async (): Promise<void> => {
    if (!panelOpen('clan')) return;
    const clanResult = await api<{ clan: ClanInfo | null }>('GET', '/api/clan');
    const invitations = await api<{ invitations: Invitation[] }>('GET', '/api/me/invitations');
    const clan = clanResult.clan;
    host.replaceChildren();

    if (clan === null) {
      host.append(el('h2', { text: 'Clan' }));
      const name = el('input', { id: 'clan-name', type: 'text' });
      name.setAttribute('aria-label', 'Clan name');
      name.setAttribute('data-field', 'name');
      const motto = el('input', { id: 'clan-motto', type: 'text' });
      motto.setAttribute('aria-label', 'Motto');
      motto.setAttribute('data-field', 'motto');
      host.append(
        el('div', { class: 'field' }, el('label', { for: 'clan-name', text: 'Clan name' }), name),
        el('div', { class: 'field' }, el('label', { for: 'clan-motto', text: 'Motto' }), motto),
        el('div', { class: 'actions' }, el('button', { class: 'primary', text: 'Found clan', onclick: async () => {
          notice('Founding…');
          try {
            await api('POST', '/api/clans', { name: name.value, motto: motto.value });
            notice(`${name.value} founded. You lead it.`);
            await update();
          } catch (err) {
            errorCopy(err);
          }
        }}))
      );
      if (invitations.invitations.length > 0) {
        const list = el('ul', { class: 'request-list', 'aria-label': 'Invitations' });
        for (const invitation of invitations.invitations) {
          list.append(el('li', {},
            el('span', { text: `Invitation to ${invitation.clan.name} from ${invitation.invitedBy.displayName}` }),
            el('button', { text: `Accept invitation to ${invitation.clan.name}`, onclick: async () => {
              notice('Joining…');
              try {
                await api('POST', `/api/invitations/${invitation.id}/accept`, {});
                notice(`You joined ${invitation.clan.name}.`);
                await update();
              } catch (err) {
                errorCopy(err);
              }
            }}),
            el('button', { text: `Decline invitation to ${invitation.clan.name}`, onclick: async () => {
              try {
                await api('POST', `/api/invitations/${invitation.id}/decline`, {});
                await update();
              } catch (err) {
                errorCopy(err);
              }
            }})
          ));
        }
        host.append(el('h3', { text: 'Invitations' }), list);
      }
      return;
    }

    state.clanChatVisible = clanTab === 'chat';
    if (clanTab === 'chat') {
      state.unreadClan = 0;
      shell!.setUnreadClan(0);
    }

    host.append(el('h2', { text: clan.name }));
    host.append(el('p', { text: clan.motto }));
    host.append(el('p', { text: `Rank ${clan.rank}` }));
    const myRequestSection = el('section', { role: 'region', 'aria-label': 'My request' });

    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const body = el('div', { class: 'rows' });

    const renderTab = async (): Promise<void> => {
      body.replaceChildren();
      if (clanTab === 'members') await renderMembers(clan, body);
      if (clanTab === 'chat') await renderChat(clan, body);
      if (clanTab === 'requests') await renderRequests(clan, body);
      myRequestSection.replaceChildren();
      const requests = await api<{ mine: UnitRequest | null; requests: UnitRequest[] }>('GET', '/api/clan/requests');
      if (requests.mine !== null) {
        const mine = requests.mine;
        myRequestSection.append(el('p', { text: `${mine.given} of ${mine.count} ${unitLabel(mine.unit)}` }));
        if (mine.state === 'open') {
          myRequestSection.append(el('button', { text: 'Cancel my request', onclick: async () => {
            notice('Cancelling…');
            try {
              await api('POST', `/api/clan/requests/${mine.id}/cancel`, {});
              notice('Request cancelled.');
              await update();
            } catch (err) {
              errorCopy(err);
            }
          }}));
        }
      }
    };

    for (const [key, label] of [['members', 'Members'], ['chat', 'Chat'], ['requests', 'Requests']] as const) {
      const tab = el('button', { role: 'tab', text: label, 'aria-selected': String(clanTab === key), onclick: () => {
        clanTab = key;
        state.clanChatVisible = key === 'chat';
        if (key === 'chat') {
          state.unreadClan = 0;
          shell!.setUnreadClan(0);
        }
        for (const button of tabs.querySelectorAll('button')) button.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-selected', 'true');
        void renderTab();
      }});
      tabs.append(tab);
    }

    host.append(myRequestSection, tabs, body);
    host.append(el('div', { class: 'actions' }, el('button', { text: 'Leave clan', onclick: async () => {
      notice('Leaving…');
      try {
        const result = await api<{ newSkipper: { displayName: string } | null; disbanded: boolean }>('POST', '/api/clan/leave', {});
        if (result.disbanded) notice(`${clan.name} left. The clan was disbanded.`);
        else if (result.newSkipper) notice(`You left ${clan.name}. ${result.newSkipper.displayName} now leads it.`);
        else notice(`You left ${clan.name}.`);
        await update();
      } catch (err) {
        errorCopy(err);
      }
    }})));
    await renderTab();
  };

  await update();

  setPollJob('clan', async () => {
    if (!panelOpen('clan')) return;
    const clanResult = await api<{ clan: ClanInfo | null }>('GET', '/api/clan');
    if (clanResult.clan === null && state.me?.clanId !== null) {
      // removed from the clan: the panel switches to the no-clan view with the removal copy
      alertMessage('You are no longer in the clan.');
      state.me = { ...state.me!, clanId: null };
    }
    await update();
  });
}

async function renderMembers(clan: ClanInfo, body: HTMLElement): Promise<void> {
  const zone = state.me?.timeZone ?? 'UTC';
  void zone;
  const table = el('table', { class: 'data', 'aria-label': 'Roster' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Name' }), el('th', { text: 'Role' }), el('th', { class: 'num', text: 'Trophies' }), el('th', { class: 'num', text: 'Donated' }), el('th', { class: 'num', text: 'Received' })
  )));
  const roleLabels: Record<string, string> = { skipper: 'Skipper', mate: 'Mate', deckhand: 'Deckhand' };
  const tbody = el('tbody');
  const me = clan.myRole;
  const isWarden = me === 'skipper' || me === 'mate';
  for (const member of clan.members) {
    const row = el('tr', {},
      el('td', { text: member.displayName }),
      el('td', { text: roleLabels[member.role] ?? member.role }),
      el('td', { class: 'num', text: commaFormat(member.trophies) }),
      el('td', { class: 'num', text: commaFormat(member.donated) }),
      el('td', { class: 'num', text: commaFormat(member.received) })
    );
    const actionsCell = el('td');
    if (member.accountId !== state.me?.id) {
      if (isWarden) {
        actionsCell.append(el('button', { text: `Promote ${member.displayName}`, onclick: () => void roleChange(member.accountId, 'promote', member.displayName) }));
        actionsCell.append(el('button', { text: `Demote ${member.displayName}`, onclick: () => void roleChange(member.accountId, 'demote', member.displayName) }));
        actionsCell.append(el('button', { text: `Remove ${member.displayName}`, onclick: async () => {
          notice('Removing…');
          try {
            await api('DELETE', `/api/clan/members/${member.accountId}`);
            notice(`${member.displayName} was removed from the clan.`);
          } catch (err) {
            errorCopy(err);
          }
        }}));
      }
    }
    row.append(actionsCell);
    tbody.append(row);
  }
  table.append(tbody);
  body.append(table);
  if (isWarden) {
    const email = el('input', { id: 'invite-email', type: 'email' });
    email.setAttribute('data-field', 'email');
    email.setAttribute('aria-label', 'Invite by email');
    body.append(
      el('div', { class: 'field' }, el('label', { for: 'invite-email', text: 'Invite by email' }), email),
      el('button', { text: 'Send invitation', onclick: async () => {
        notice('Inviting…');
        try {
          await api('POST', '/api/clan/invitations', { email: email.value });
          notice(`Invitation recorded for ${email.value}. The mail may take a few minutes.`);
          email.value = '';
        } catch (err) {
          errorCopy(err);
        }
      }})
    );
  }
}

async function roleChange(accountId: number, action: 'promote' | 'demote', name: string): Promise<void> {
  notice('Updating…');
  try {
    const member = await api<{ role: string }>('POST', `/api/clan/members/${accountId}/${action}`, {});
    const roleLabels: Record<string, string> = { skipper: 'Skipper', mate: 'Mate', deckhand: 'Deckhand' };
    notice(`${name} is now ${roleLabels[member.role] ?? member.role}.`);
  } catch (err) {
    errorCopy(err);
  }
}

async function renderChat(clan: ClanInfo, body: HTMLElement): Promise<void> {
  const log = el('ul', { class: 'chat-log', 'aria-label': 'Clan chat' });
  const result = await api<{ messages: Message[] }>('GET', '/api/clan/messages');
  const isWarden = clan.myRole === 'skipper' || clan.myRole === 'mate';
  const knownIds = new Set<number>();
  const fill = (messages: Message[]): void => {
    if (log.children.length === 0) {
      for (const message of messages) appendMessage(message);
      return;
    }
    for (const message of messages) {
      if (!knownIds.has(message.id)) {
        appendMessage(message);
      }
    }
  };
  const appendMessage = (message: Message): void => {
    knownIds.add(message.id);
    const row = el('li', {},
      el('span', { text: message.removed ? 'Message removed by a warden' : `${message.author.displayName}: ${message.body}` })
    );
    if (isWarden && !message.removed) {
      row.append(el('button', { text: `Delete message from ${message.author.displayName}`, onclick: async () => {
        notice('Removing…');
        try {
          await api('DELETE', `/api/clan/messages/${message.id}`);
          row.replaceChildren(el('span', { class: 'removed', text: 'Message removed by a warden' }));
          notice('Message removed.');
        } catch (err) {
          errorCopy(err);
        }
      }}));
    }
    log.append(row);
  };
  fill(result.messages);
  const input = el('input', { id: 'chat-message', type: 'text' });
  input.setAttribute('aria-label', 'Message');
  input.setAttribute('data-field', 'body');
  const send = el('button', { text: 'Send', onclick: async () => {
    if (input.value.trim().length === 0) return;
    notice('Sending…');
    try {
      const message = await api<Message>('POST', '/api/clan/messages', { body: input.value });
      appendMessage(message);
      input.value = '';
    } catch (err) {
      errorCopy(err);
    }
  }});
  body.append(log, el('div', { class: 'row' }, input, send));
}

async function renderRequests(clan: ClanInfo, body: HTMLElement): Promise<void> {
  void clan;
  const result = await api<{ mine: UnitRequest | null; requests: UnitRequest[] }>('GET', '/api/clan/requests');
  const saltjack = el('input', { type: 'radio', name: 'request-unit', id: 'request-saltjack', value: 'saltjack', checked: true });
  const slinger = el('input', { type: 'radio', name: 'request-unit', id: 'request-peat_slinger', value: 'peat_slinger' });
  const count = el('input', { type: 'number', id: 'request-count', min: '1', max: '6', value: '2' });
  count.setAttribute('aria-label', 'Count');
  body.append(
    el('div', { role: 'radiogroup', 'aria-label': 'Units' },
      el('label', { for: 'request-saltjack' }, saltjack, el('span', { text: 'Saltjack' })),
      el('label', { for: 'request-peat_slinger' }, slinger, el('span', { text: 'Peat Slinger' }))
    ),
    el('div', { class: 'field' }, el('label', { for: 'request-count', text: 'Count' }), count),
    el('button', { text: 'Request units', onclick: async () => {
      const unit = document.querySelector<HTMLInputElement>('input[name="request-unit"]:checked')?.value as 'saltjack' | 'peat_slinger';
      notice('Posting…');
      try {
        await api('POST', '/api/clan/requests', { unit, count: Number(count.value) || 1 });
        notice(`Request posted for ${count.value} ${unitLabel(unit)}.`);
        await renderRequests(clan, body);
      } catch (err) {
        errorCopy(err);
      }
    }})
  );

  const list = el('ul', { class: 'request-list' });
  for (const request of result.requests) {
    const isMine = request.requester.accountId === state.me?.id;
    if (isMine) continue;
    list.append(el('li', {},
      el('span', { text: `${request.requester.displayName}: ${request.given} of ${request.count} ${unitLabel(request.unit)}` }),
      el('button', { text: `Donate to ${request.requester.displayName}`, onclick: () => openDonateDialog(request) })
    ));
  }
  if (list.children.length > 0) body.append(el('h3', { text: 'Open requests' }), list);
}

function openDonateDialog(request: UnitRequest): void {
  const dialog = el('dialog') as HTMLDialogElement;
  dialog.setAttribute('aria-label', 'Donate');
  const count = el('input', { type: 'number', id: 'donate-count', min: '1', max: '3', value: '1' });
  count.setAttribute('aria-label', 'Count');
  const card = el('div', { class: 'dialog-card' },
    el('h2', { text: `Donate to ${request.requester.displayName}` }),
    el('div', { class: 'field' }, el('label', { for: 'donate-count', text: 'Count' }), count),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', text: 'Donate', onclick: async () => {
        notice('Donating…');
        try {
          const result = await api<{ donation: { count: number } }>('POST', `/api/clan/requests/${request.id}/donations`, { count: Number(count.value) || 1 }, { idempotencyKey: idempotencyKey() });
          notice(`You donated ${result.donation.count} ${unitLabel(request.unit)} to ${request.requester.displayName}.`);
          dialog.close();
          dialog.remove();
          void openPanel('clan', shell!);
        } catch (err) {
          errorCopy(err);
        }
      }}),
      el('button', { text: 'Close', onclick: () => { dialog.close(); dialog.remove(); } })
    )
  );
  dialog.append(card);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      dialog.remove();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  count.focus();
}

// --- League ---

async function renderLeague(): Promise<void> {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'League');
  host.replaceChildren(el('h2', { text: 'League' }));
  const result = await api<{ clans: { rank: number; id: number; name: string; trophies: number; memberCount: number }[] }>('GET', '/api/league/clans');
  const table = el('table', { class: 'data', 'aria-label': 'Clan standings' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Rank' }), el('th', { text: 'Clan' }), el('th', { class: 'num', text: 'Trophies' }), el('th', { class: 'num', text: 'Members' })
  )));
  const tbody = el('tbody');
  for (const clan of result.clans) {
    tbody.append(el('tr', {},
      el('td', { class: 'num', text: String(clan.rank) }),
      el('td', { text: clan.name }),
      el('td', { class: 'num', text: commaFormat(clan.trophies) }),
      el('td', { class: 'num', text: String(clan.memberCount) })
    ));
  }
  table.append(tbody);
  host.append(table);
}

// --- Profile ---

async function renderProfile(): Promise<void> {
  const host = shell!.panelHost;
  host.className = 'context-panel';
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Profile');
  host.replaceChildren(el('h2', { text: 'Profile' }));
  const me = state.me;
  const displayName = el('input', { id: 'profile-name', type: 'text', value: me?.displayName ?? '' });
  displayName.setAttribute('aria-label', 'Display name');
  displayName.setAttribute('data-field', 'displayName');
  const timeZone = el('select', { id: 'profile-zone' });
  timeZone.setAttribute('aria-label', 'Time zone');
  timeZone.setAttribute('data-field', 'timeZone');
  try {
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      const option = el('option', { value: zone, text: zone });
      if (zone === me?.timeZone) option.selected = true;
      timeZone.append(option);
    }
  } catch {
    timeZone.append(el('option', { value: 'UTC', text: 'UTC' }));
  }
  host.append(
    el('div', { class: 'field' }, el('label', { for: 'profile-name', text: 'Display name' }), displayName),
    el('div', { class: 'field' }, el('label', { for: 'profile-zone', text: 'Time zone' }), timeZone),
    el('div', { class: 'actions' }, el('button', { class: 'primary', text: 'Save profile', onclick: async () => {
      notice('Saving…');
      try {
        const updated = await api<typeof state.me>('PATCH', '/api/me', { displayName: displayName.value, timeZone: timeZone.value });
        state.me = updated;
        notice('Profile saved.');
      } catch (err) {
        errorCopy(err);
      }
    }}))
  );
}
