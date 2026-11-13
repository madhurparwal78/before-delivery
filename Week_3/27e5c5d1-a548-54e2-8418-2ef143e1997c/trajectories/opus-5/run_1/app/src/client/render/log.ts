import type { PermissionLogEntry } from '../../shared/types';
import { call } from '../lib/api';
import { el } from '../lib/dom';
import { requestRender, state } from '../store';
import { signOut } from '../session';

export async function openPermissionLog(workspaceId?: string): Promise<void> {
  const id = workspaceId ?? state.workspace?.id;
  if (id === undefined) return;
  const reply = await call<{ entries: PermissionLogEntry[] }>(`/api/workspaces/${id}/permission-log`);
  state.logEntries = reply.entries;
  state.screen = 'permissionLog';
  requestRender();
}

function cell(value: string | string[] | null): string {
  if (value === null) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

export function renderPermissionLog(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const header = el('header', { class: 'topbar' });
  header.append(el('h1', { class: 'masthead', text: 'Permission log' }));
  header.append(
    el('button', {
      class: 'account',
      text: 'Sign out',
      focusKey: 'log:signout',
      attrs: { type: 'button' },
      on: { click: () => void signOut() },
    }),
  );
  fragment.append(header);
  const main = el('main', { class: 'log' });
  const back = el('a', {
    text: 'Back to the board',
    focusKey: 'log:back',
    attrs: { href: state.boardId === null ? '/' : `/boards/${state.boardId}` },
  });
  main.append(back);
  const table = el('table', { class: 'log-table', attrs: { 'aria-label': 'Permission log' } });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'When' }),
        el('th', { text: 'Who' }),
        el('th', { text: 'What' }),
        el('th', { text: 'Target' }),
        el('th', { text: 'Before' }),
        el('th', { text: 'After' }),
      ]),
    ]),
  );
  const body = el('tbody');
  for (const entry of state.logEntries as PermissionLogEntry[]) {
    body.append(
      el('tr', {}, [
        el('td', { text: entry.at }),
        el('td', { text: entry.actor.displayName }),
        el('td', { text: entry.action }),
        el('td', { text: entry.target.label }),
        el('td', { text: cell(entry.before) }),
        el('td', { text: cell(entry.after) }),
      ]),
    );
  }
  table.append(body);
  main.append(table);
  fragment.append(main);
  return fragment;
}
