import { request } from '../../api.js';
import { noticeCopy, pendingCopy, ROLE_LABELS } from '../../copy.js';
import { button, el, field, setText } from '../../dom.js';
import { number } from '../../format.js';
import {
  refreshClan,
  refreshInvitations,
  refreshMessages,
  refreshRequests,
  clanRemovalNotice,
  refreshVillage,
  showChat,
  state
} from '../../store.js';
import { UNITS } from '../../../shared/catalog.js';
import { UNIT_KEYS, type ClanRole, type UnitKey } from '../../../shared/types.js';
import type { ChatMessage, ClanBody, Member, UnitRequest } from '../../apitypes.js';
import { run } from '../action.js';

type Tab = 'members' | 'chat' | 'requests';

function mayPromote(myRole: ClanRole, member: Member, mine: number): boolean {
  if (myRole !== 'skipper' || member.accountId === mine) return false;
  return member.role === 'deckhand' || member.role === 'mate';
}

function mayDemote(myRole: ClanRole, member: Member, mine: number): boolean {
  return myRole === 'skipper' && member.role === 'mate' && member.accountId !== mine;
}

function mayRemove(myRole: ClanRole, member: Member, mine: number): boolean {
  if (member.accountId === mine || member.role === 'skipper') return false;
  if (myRole === 'skipper') return true;
  return myRole === 'mate' && member.role === 'deckhand';
}

export function clanPanel(handlers: { onChanged: () => void }): {
  node: HTMLElement;
  update: () => void;
} {
  let tab: Tab = 'members';
  let requestUnit: UnitKey = 'saltjack';
  const node = el('aside', { role: 'complementary', 'aria-label': 'Clan', class: 'panel' });

  const renderNoClan = (): void => {
    const name = field('Clan name');
    const motto = field('Motto');
    const found = button('Found clan', { class: 'primary' });
    found.addEventListener('click', () => {
      void run({
        action: 'foundClan',
        pending: pendingCopy.foundClan,
        control: found,
        fields: { name, motto },
        work: () =>
          request<{ clan: ClanBody }>('POST', '/api/clans', {
            body: { name: name.input.value, motto: motto.input.value }
          }),
        success: (result) => noticeCopy.foundClanSuccess(result.clan.name)
      }).then(async () => {
        await refreshClan();
        await refreshMessages();
        await refreshRequests();
        handlers.onChanged();
      });
    });

    const invitations = el('ul', {
      role: 'list',
      'aria-label': 'Invitations',
      class: 'invitations'
    });
    for (const invitation of state.invitations) {
      const accept = button(`Accept invitation to ${invitation.clan.name}`, { class: 'primary' });
      accept.addEventListener('click', () => {
        void run({
          action: 'accept',
          pending: pendingCopy.accept,
          control: accept,
          work: () =>
            request<{ clan: ClanBody }>('POST', `/api/invitations/${invitation.id}/accept`, {
              body: {}
            }),
          success: (result) => noticeCopy.acceptSuccess(result.clan.name)
        }).then(async () => {
          await refreshClan();
          await refreshInvitations();
          await refreshMessages();
          await refreshRequests();
          handlers.onChanged();
        });
      });
      const decline = button(`Decline invitation to ${invitation.clan.name}`);
      decline.addEventListener('click', () => {
        void run({
          action: 'accept',
          pending: pendingCopy.accept,
          control: decline,
          work: () =>
            request<void>('POST', `/api/invitations/${invitation.id}/decline`, { body: {} }),
          success: () => null
        }).then(async () => {
          await refreshInvitations();
          handlers.onChanged();
        });
      });
      invitations.append(
        el('li', {}, [el('span', { text: invitation.clan.name }), accept, decline])
      );
    }

    const children: Node[] = [el('h2', { text: 'Clan' })];
    const removedFrom = clanRemovalNotice();
    if (removedFrom !== null) {
      children.push(
        el('p', { class: 'danger-text', text: noticeCopy.removedFromClan(removedFrom) })
      );
    }
    children.push(name.wrapper, motto.wrapper, found, invitations);
    node.replaceChildren(...children);
  };

  const renderMembersTab = (clan: ClanBody): HTMLElement[] => {
    const rows = clan.members.map((member) => {
      const cells: Node[] = [
        el('td', { text: member.displayName }),
        el('td', { text: ROLE_LABELS[member.role] ?? member.role }),
        el('td', { text: number(member.trophies) }),
        el('td', { text: number(member.donated) }),
        el('td', { text: number(member.received) })
      ];
      const actions = el('td', { class: 'row-actions' });
      const mine = state.user?.id ?? -1;
      if (mayPromote(clan.myRole, member, mine)) {
        const promote = button(`Promote ${member.displayName}`);
        promote.addEventListener('click', () => {
          void run({
            action: 'role',
            pending: pendingCopy.role,
            control: promote,
            work: () =>
              request<Member>('POST', `/api/clan/members/${member.accountId}/promote`, {
                body: {}
              }),
            success: (result) =>
              noticeCopy.roleSuccess(result.displayName, ROLE_LABELS[result.role] ?? result.role)
          }).then(async () => {
            await refreshClan();
            handlers.onChanged();
          });
        });
        actions.append(promote);
      }
      if (mayDemote(clan.myRole, member, mine)) {
        const demote = button(`Demote ${member.displayName}`);
        demote.addEventListener('click', () => {
          void run({
            action: 'role',
            pending: pendingCopy.role,
            control: demote,
            work: () =>
              request<Member>('POST', `/api/clan/members/${member.accountId}/demote`, {
                body: {}
              }),
            success: (result) =>
              noticeCopy.roleSuccess(result.displayName, ROLE_LABELS[result.role] ?? result.role)
          }).then(async () => {
            await refreshClan();
            handlers.onChanged();
          });
        });
        actions.append(demote);
      }
      if (mayRemove(clan.myRole, member, mine)) {
        const remove = button(`Remove ${member.displayName}`);
        remove.addEventListener('click', () => {
          void run({
            action: 'removeMember',
            pending: pendingCopy.removeMember,
            control: remove,
            work: () =>
              request<void>('DELETE', `/api/clan/members/${member.accountId}`),
            success: () => noticeCopy.removeSuccess(member.displayName)
          }).then(async () => {
            await refreshClan();
            handlers.onChanged();
          });
        });
        actions.append(remove);
      }
      cells.push(actions);
      return el('tr', {}, cells);
    });

    const table = el('table', { role: 'table', 'aria-label': 'Roster', class: 'table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Role' }),
          el('th', { scope: 'col', text: 'Trophies' }),
          el('th', { scope: 'col', text: 'Donated' }),
          el('th', { scope: 'col', text: 'Received' }),
          el('th', { scope: 'col', text: 'Actions' })
        ])
      ]),
      el('tbody', {}, rows)
    ]);

    const children: HTMLElement[] = [table];
    if (clan.myRole === 'skipper' || clan.myRole === 'mate') {
      const email = field('Invite by email', 'email');
      const send = button('Send invitation', { class: 'primary' });
      send.addEventListener('click', () => {
        void run({
          action: 'invite',
          pending: pendingCopy.invite,
          control: send,
          fields: { email },
          work: () =>
            request<{ status: string }>('POST', '/api/clan/invitations', {
              body: { email: email.input.value }
            }),
          success: () => noticeCopy.inviteSuccess(email.input.value)
        });
      });
      children.push(el('div', { class: 'invite-row' }, [email.wrapper, send]));
    }
    return children;
  };

  const renderChatTab = (clan: ClanBody): HTMLElement[] => {
    const log = el('div', { role: 'log', 'aria-label': 'Clan chat', class: 'chat-log' });
    for (const message of state.messages) {
      const row = el('div', { class: 'chat-row' }, [
        el('span', { class: 'chat-author', text: message.author.displayName }),
        el('span', {
          class: 'chat-body',
          text: message.removed ? noticeCopy.messageRemoved : (message.body ?? '')
        })
      ]);
      if ((clan.myRole === 'skipper' || clan.myRole === 'mate') && !message.removed) {
        const remove = button(`Delete message from ${message.author.displayName}`);
        remove.addEventListener('click', () => {
          void run({
            action: 'deleteMessage',
            pending: pendingCopy.deleteMessage,
            control: remove,
            work: () => request<void>('DELETE', `/api/clan/messages/${message.id}`),
            success: () => null
          }).then(async () => {
            await refreshMessages();
            handlers.onChanged();
          });
        });
        row.append(remove);
      }
      log.append(row);
    }
    const body = field('Message');
    const send = button('Send', { class: 'primary' });
    const post = (): void => {
      void run({
        action: 'message',
        pending: pendingCopy.message,
        control: send,
        fields: { body },
        work: () =>
          request<ChatMessage>('POST', '/api/clan/messages', { body: { body: body.input.value } }),
        success: () => null
      }).then(async (result) => {
        if (result !== null) body.input.value = '';
        await refreshMessages();
        handlers.onChanged();
      });
    };
    send.addEventListener('click', post);
    body.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        post();
      }
    });
    return [log, el('div', { class: 'chat-compose' }, [body.wrapper, send])];
  };

  const openDonateDialog = (target: UnitRequest, opener: HTMLButtonElement): void => {
    const count = el('input', {
      type: 'number',
      min: '1',
      max: '3',
      value: '1',
      'aria-label': 'Count'
    });
    const donate = button('Donate', { class: 'primary' });
    const close = button('Close');
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-label': 'Donate', 'aria-modal': 'true', class: 'dialog' },
      [
        el('h2', { text: `Donate to ${target.requester.displayName}` }),
        el('label', {}, ['Count', count]),
        donate,
        close
      ]
    );
    const dismiss = (): void => {
      dialog.remove();
      opener.focus();
    };
    close.addEventListener('click', dismiss);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dismiss();
      if (event.key === 'Tab') {
        const focusable: HTMLElement[] = [count, donate, close];
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = event.shiftKey ? index - 1 : index + 1;
        focusable[(next + focusable.length) % focusable.length]?.focus();
      }
    });
    donate.addEventListener('click', () => {
      void run({
        action: 'donate',
        pending: pendingCopy.donate,
        control: donate,
        work: () =>
          request<{ request: UnitRequest }>(
            'POST',
            `/api/clan/requests/${target.id}/donations`,
            { body: { count: Number(count.value) } }
          ),
        success: (result) =>
          noticeCopy.donateSuccess(
            Number(count.value),
            UNITS[result.request.unit].name,
            result.request.requester.displayName
          )
      }).then(async (result) => {
        if (result !== null) dismiss();
        await refreshRequests();
        await refreshClan();
        await refreshVillage();
        handlers.onChanged();
      });
    });
    node.append(dialog);
    count.focus();
  };

  const renderRequestsTab = (): HTMLElement[] => {
    const radios = UNIT_KEYS.map((key) => {
      const radio = el('button', {
        type: 'button',
        role: 'radio',
        'aria-label': UNITS[key].name,
        'aria-checked': key === requestUnit ? 'true' : 'false',
        class: 'radio',
        text: UNITS[key].name
      });
      radio.addEventListener('click', () => {
        requestUnit = key;
        for (const [index, other] of radios.entries()) {
          other.setAttribute('aria-checked', UNIT_KEYS[index] === requestUnit ? 'true' : 'false');
        }
      });
      return radio;
    });
    const count = el('input', {
      type: 'number',
      min: '1',
      max: '6',
      value: '1',
      'aria-label': 'Count'
    });
    const post = button('Request units', { class: 'primary' });
    post.addEventListener('click', () => {
      void run({
        action: 'requestUnits',
        pending: pendingCopy.requestUnits,
        control: post,
        work: () =>
          request<UnitRequest>('POST', '/api/clan/requests', {
            body: { unit: requestUnit, count: Number(count.value) }
          }),
        success: (result) => noticeCopy.requestSuccess(result.count, UNITS[result.unit].name)
      }).then(async () => {
        await refreshRequests();
        handlers.onChanged();
      });
    });

    const rows = state.requests.requests.map((entry) => {
      const row = el('div', { class: 'request-row' }, [
        el('span', {
          text: `${entry.given} of ${entry.count} ${UNITS[entry.unit].name}`
        }),
        el('span', { class: 'request-owner', text: entry.requester.displayName })
      ]);
      if (entry.requester.accountId !== (state.user?.id ?? -1)) {
        const donate = button(`Donate to ${entry.requester.displayName}`);
        donate.addEventListener('click', () => openDonateDialog(entry, donate));
        row.append(donate);
      }
      return row;
    });

    return [
      el('div', { role: 'radiogroup', 'aria-label': 'Request units', class: 'radio-group' }, radios),
      el('label', {}, ['Count', count]),
      post,
      el('div', { class: 'request-rows' }, rows)
    ];
  };

  const renderClan = (clan: ClanBody): void => {
    const children: Node[] = [
      el('h2', { text: clan.name }),
      el('p', { text: `Rank ${clan.rank}` }),
      el('p', { class: 'motto', text: clan.motto })
    ];

    const mine = state.requests.mine;
    if (mine !== null) {
      const region = el('div', { role: 'region', 'aria-label': 'My request', class: 'my-request' }, [
        el('span', { text: `${mine.given} of ${mine.count} ${UNITS[mine.unit].name}` })
      ]);
      if (mine.state === 'open') {
        const cancel = button('Cancel my request');
        cancel.addEventListener('click', () => {
          void run({
            action: 'cancelRequest',
            pending: pendingCopy.cancelRequest,
            control: cancel,
            work: () =>
              request<UnitRequest>('POST', `/api/clan/requests/${mine.id}/cancel`, { body: {} }),
            success: () => noticeCopy.cancelRequestSuccess
          }).then(async () => {
            await refreshRequests();
            handlers.onChanged();
          });
        });
        region.append(cancel);
      }
      children.push(region);
    }

    const tabs = el('div', { role: 'tablist', 'aria-label': 'Clan sections', class: 'tabs' });
    const makeTab = (name: Tab, label: string): HTMLButtonElement => {
      const node2 = el('button', {
        type: 'button',
        role: 'tab',
        'aria-label': label,
        'aria-selected': tab === name ? 'true' : 'false',
        class: 'tab',
        text: label
      });
      node2.addEventListener('click', () => {
        tab = name;
        showChat(name === 'chat');
        update();
        handlers.onChanged();
      });
      return node2;
    };
    tabs.append(
      makeTab('members', 'Members'),
      makeTab('chat', 'Chat'),
      makeTab('requests', 'Requests')
    );
    children.push(tabs);

    if (tab === 'members') children.push(...renderMembersTab(clan));
    else if (tab === 'chat') children.push(...renderChatTab(clan));
    else children.push(...renderRequestsTab());

    const leave = button('Leave clan');
    leave.addEventListener('click', () => {
      void run({
        action: 'role',
        pending: pendingCopy.leaveClan,
        control: leave,
        work: () =>
          request<{ newSkipper: { displayName: string } | null; disbanded: boolean }>(
            'POST',
            '/api/clan/leave',
            { body: {} }
          ),
        success: (result) => {
          if (result.disbanded) return noticeCopy.leaveSuccessDisbanded(clan.name);
          if (result.newSkipper !== null) {
            return noticeCopy.leaveSuccessHandover(clan.name, result.newSkipper.displayName);
          }
          return noticeCopy.leaveSuccess(clan.name);
        }
      }).then(async () => {
        await refreshClan();
        await refreshInvitations();
        handlers.onChanged();
      });
    });
    children.push(leave);
    node.replaceChildren(...children);
  };

  let signature = '';

  const signatureOf = (): string =>
    JSON.stringify([
      tab,
      requestUnit,
      clanRemovalNotice(),
      state.clan && {
        id: state.clan.id,
        name: state.clan.name,
        rank: state.clan.rank,
        role: state.clan.myRole,
        members: state.clan.members.map((member) => [
          member.accountId,
          member.role,
          member.trophies,
          member.donated,
          member.received
        ])
      },
      state.messages.map((message) => [message.id, message.removed]),
      state.requests.requests.map((entry) => [entry.id, entry.given, entry.count, entry.state]),
      state.requests.mine && [
        state.requests.mine.id,
        state.requests.mine.given,
        state.requests.mine.state
      ],
      state.invitations.map((invitation) => invitation.id)
    ]);

  const update = (): void => {
    const next = signatureOf();
    if (next === signature) return;
    signature = next;
    const draft = node.querySelector<HTMLInputElement>('input[aria-label="Message"]')?.value ?? '';
    const clan = state.clan;
    if (clan === null) {
      showChat(false);
      renderNoClan();
      return;
    }
    renderClan(clan);
    const input = node.querySelector<HTMLInputElement>('input[aria-label="Message"]');
    if (input && draft !== '') input.value = draft;
  };

  const refreshTexts = (): void => {
    const mine = state.requests.mine;
    const region = node.querySelector('.my-request span');
    if (mine !== null && region !== null) {
      setText(region, `${mine.given} of ${mine.count} ${UNITS[mine.unit].name}`);
    }
  };

  void (async () => {
    await refreshClan();
    await refreshInvitations();
    await refreshMessages();
    await refreshRequests();
    update();
  })();

  return {
    node,
    update: () => {
      update();
      refreshTexts();
    }
  };
}
