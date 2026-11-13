import { api, ApiCallError } from '../api.ts';
import { clear, h, statusRegion } from '../dom.ts';
import { subscribe, type LiveSubscription } from '../live.ts';
import { GENERIC_ERROR, LAST_OWNER_ERROR, ROLE_WORD } from '../../shared/copy.ts';
import type { Role, TeamMemberJson } from '../../shared/types.ts';
import type { Frame } from '../frame.ts';
import type { Screen } from './documents.ts';

const ROLES: readonly Role[] = ['owner', 'member', 'viewer'];

export const teamScreen = (frame: Frame, initialRole: Role): Screen => {
  let role: Role = initialRole;
  let live: LiveSubscription | null = null;
  const body = h('tbody');
  const error = h('p', { class: 'field-error', role: 'alert' });
  const region = statusRegion('Document updates');
  const table = h(
    'table',
    { 'aria-label': 'Members', class: 'members-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Name'),
        h('th', { scope: 'col' }, 'Email'),
        h('th', { scope: 'col' }, 'Role'),
      ),
    ),
    body,
  );

  const root = h(
    'div',
    { class: 'team-screen' },
    h('h1', { class: 'page-heading' }, 'Team'),
    error,
    region,
    table,
  );

  const render = (members: readonly TeamMemberJson[]): void => {
    clear(body);
    for (const member of members) {
      let cell: HTMLElement;
      if (role === 'owner') {
        const select = h('select', { 'aria-label': `Role for ${member.name}` });
        for (const option of ROLES) {
          select.appendChild(
            h('option', { value: option, selected: option === member.role }, ROLE_WORD[option]),
          );
        }
        select.addEventListener('change', () => {
          error.textContent = '';
          void (async () => {
            try {
              await api.setRole(member.id, select.value);
              await refresh();
            } catch (failure) {
              select.value = member.role;
              error.textContent =
                failure instanceof ApiCallError && failure.failure.error === 'last_owner'
                  ? LAST_OWNER_ERROR
                  : GENERIC_ERROR;
            }
          })();
        });
        cell = h('td', {}, select);
      } else {
        cell = h('td', {}, ROLE_WORD[member.role]);
      }
      body.appendChild(h('tr', {}, h('td', {}, member.name), h('td', {}, member.email), cell));
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      render((await api.team()).members);
    } catch {
      error.textContent = GENERIC_ERROR;
    }
  };

  void refresh();
  live = subscribe({ scope: 'team' }, (payload) => {
    if (payload.role !== undefined && payload.role !== role) {
      role = payload.role;
      frame.setRole(role);
      void refresh();
    }
    if (payload.notice !== undefined) frame.setNotice(payload.notice);
  });

  return { root, destroy: () => live?.close() };
};
